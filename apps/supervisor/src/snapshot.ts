import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SnapshotOptions = {
  featherHomeDir: string;
  repoRoot: string;
  snapshotsDir: string;
  reason: string;
  now?: Date;
};

export type SnapshotResult = {
  ok: boolean;
  id: string;
  path: string;
  files: string[];
  skipped: string[];
  warnings: string[];
};

const FORBIDDEN_PATH_PARTS = new Set(["node_modules", "dist", ".git", "snapshots", "tmp"]);
const FORBIDDEN_BASENAMES = [
  ".env",
  ".env.local",
  "credentials.json",
  "secrets.json",
];
const FORBIDDEN_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".log"]);
const SECRET_KEY_PATTERN = /(?:token|api[_-]?key|apikey|secret|password)/i;
const SECRET_ASSIGNMENT_PATTERN = /^(\s*["']?[\w.-]*(?:token|api[_-]?key|apikey|secret|password)[\w.-]*["']?\s*[:=]\s*)(["']?)(.*?)(["']?\s*,?\s*)$/i;
const BUSY_ERROR_CODES = new Set(["EBUSY", "EPERM"]);
const COPY_ATTEMPTS = 4;

export function createSnapshot(options: SnapshotOptions): SnapshotResult {
  const lock = acquireSnapshotLock(options.featherHomeDir);
  if (!lock.acquired) {
    return {
      ok: false,
      id: "snapshot-in-progress",
      path: "",
      files: [],
      skipped: [],
      warnings: [lock.warning],
    };
  }

  try {
    const now = options.now ?? new Date();
    const id = `${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}-${randomUUID().slice(0, 8)}`;
    const snapshotDir = path.join(options.snapshotsDir, id);
    fs.mkdirSync(snapshotDir, { recursive: true });

    const files: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    const manifest = {
      id,
      createdAt: now.toISOString(),
      reason: options.reason,
      excludes: [
        "secrets and local env files",
        "logs",
        "node_modules",
        "dist",
        ".git",
        "snapshots",
      ],
      warnings,
      skipped,
    };

    copyIfSafe(path.join(options.featherHomeDir, "config.yml"), path.join(snapshotDir, "home", "config.yml"), files, skipped, warnings, { redactSecrets: true });
    copyIfSafe(path.join(options.featherHomeDir, "agent.md"), path.join(snapshotDir, "home", "agent.md"), files, skipped, warnings);
    copyIfSafe(path.join(options.featherHomeDir, "feather.db"), path.join(snapshotDir, "home", "feather.db"), files, skipped, warnings);
    copyIfSafe(path.join(options.featherHomeDir, "feather.db-wal"), path.join(snapshotDir, "home", "feather.db-wal"), files, skipped, warnings);
    copyIfSafe(path.join(options.featherHomeDir, "feather.db-shm"), path.join(snapshotDir, "home", "feather.db-shm"), files, skipped, warnings);
    copyDirectoryIfSafe(path.join(options.featherHomeDir, "memory"), path.join(snapshotDir, "home", "memory"), files, skipped, warnings);
    copyDirectoryIfSafe(path.join(options.featherHomeDir, "skills"), path.join(snapshotDir, "home", "skills"), files, skipped, warnings);
    copyIfSafe(path.join(options.repoRoot, "package.json"), path.join(snapshotDir, "runtime", "package.json"), files, skipped, warnings);
    copyIfSafe(path.join(options.repoRoot, "pnpm-lock.yaml"), path.join(snapshotDir, "runtime", "pnpm-lock.yaml"), files, skipped, warnings);

    const ok = files.length > 0;
    fs.writeFileSync(path.join(snapshotDir, "manifest.json"), `${JSON.stringify({ ...manifest, ok, files }, null, 2)}\n`, "utf8");
    return { ok, id, path: snapshotDir, files, skipped, warnings };
  } finally {
    releaseSnapshotLock(lock.path);
  }
}

export function isSafeSnapshotSource(filePath: string): boolean {
  const parts = filePath.split(/[\\/]+/).map((part) => part.toLowerCase());
  if (parts.some((part) => FORBIDDEN_PATH_PARTS.has(part))) return false;
  const basename = path.basename(filePath).toLowerCase();
  if (FORBIDDEN_BASENAMES.includes(basename)) return false;
  if (basename === ".env" || basename.startsWith(".env.")) return false;
  return !FORBIDDEN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function redactSnapshotSecrets(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (!SECRET_KEY_PATTERN.test(line)) {
        return line;
      }
      return line.replace(SECRET_ASSIGNMENT_PATTERN, "$1$2REDACTED$4");
    })
    .join("\n");
}

function copyDirectoryIfSafe(sourceDir: string, targetDir: string, files: string[], skipped: string[], warnings: string[]): void {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryIfSafe(source, target, files, skipped, warnings);
    } else {
      copyIfSafe(source, target, files, skipped, warnings);
    }
  }
}

function copyIfSafe(source: string, target: string, files: string[], skipped: string[], warnings: string[], options: { redactSecrets?: boolean } = {}): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !isSafeSnapshotSource(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const relative = path.relative(path.dirname(path.dirname(target)), target).replaceAll("\\", "/");
  const copied = retryBusy(() => {
    if (options.redactSecrets) {
      const redacted = redactSnapshotSecrets(fs.readFileSync(source, "utf8"));
      fs.writeFileSync(target, redacted, "utf8");
    } else {
      fs.copyFileSync(source, target);
    }
  });
  if (!copied.ok) {
    skipped.push(relative);
    warnings.push(`Skipped ${relative}: ${copied.message}`);
    return;
  }
  files.push(relative);
}

function acquireSnapshotLock(featherHomeDir: string): { acquired: true; path: string } | { acquired: false; path: string; warning: string } {
  const locksDir = path.join(featherHomeDir, "locks");
  fs.mkdirSync(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, "snapshot.lock");
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return { acquired: true, path: lockPath };
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return { acquired: false, path: lockPath, warning: `Snapshot already in progress (${lockPath})` };
    }
    throw error;
  }
}

function releaseSnapshotLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Best effort: a missing lock should not turn a completed snapshot into a failure.
  }
}

function retryBusy(operation: () => void): { ok: true } | { ok: false; message: string } {
  for (let attempt = 1; attempt <= COPY_ATTEMPTS; attempt += 1) {
    try {
      operation();
      return { ok: true };
    } catch (error) {
      if (!isNodeError(error) || error.code === undefined || !BUSY_ERROR_CODES.has(error.code) || attempt === COPY_ATTEMPTS) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      sleepSync(25 * attempt);
    }
  }
  return { ok: false, message: "copy failed" };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
