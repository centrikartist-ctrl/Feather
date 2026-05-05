import fs from "node:fs";
import path from "node:path";

export type SnapshotOptions = {
  featherHomeDir: string;
  repoRoot: string;
  snapshotsDir: string;
  reason: string;
  now?: Date;
};

export type SnapshotResult = {
  id: string;
  path: string;
  files: string[];
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

export function createSnapshot(options: SnapshotOptions): SnapshotResult {
  const now = options.now ?? new Date();
  const id = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const snapshotDir = path.join(options.snapshotsDir, id);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const files: string[] = [];
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
  };

  copyIfSafe(path.join(options.featherHomeDir, "config.yml"), path.join(snapshotDir, "home", "config.yml"), files, { redactSecrets: true });
  copyIfSafe(path.join(options.featherHomeDir, "agent.md"), path.join(snapshotDir, "home", "agent.md"), files);
  copyIfSafe(path.join(options.featherHomeDir, "feather.db"), path.join(snapshotDir, "home", "feather.db"), files);
  copyIfSafe(path.join(options.featherHomeDir, "feather.db-wal"), path.join(snapshotDir, "home", "feather.db-wal"), files);
  copyIfSafe(path.join(options.featherHomeDir, "feather.db-shm"), path.join(snapshotDir, "home", "feather.db-shm"), files);
  copyDirectoryIfSafe(path.join(options.featherHomeDir, "memory"), path.join(snapshotDir, "home", "memory"), files);
  copyDirectoryIfSafe(path.join(options.featherHomeDir, "skills"), path.join(snapshotDir, "home", "skills"), files);
  copyIfSafe(path.join(options.repoRoot, "package.json"), path.join(snapshotDir, "runtime", "package.json"), files);
  copyIfSafe(path.join(options.repoRoot, "pnpm-lock.yaml"), path.join(snapshotDir, "runtime", "pnpm-lock.yaml"), files);

  fs.writeFileSync(path.join(snapshotDir, "manifest.json"), `${JSON.stringify({ ...manifest, files }, null, 2)}\n`, "utf8");
  return { id, path: snapshotDir, files };
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

function copyDirectoryIfSafe(sourceDir: string, targetDir: string, files: string[]): void {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryIfSafe(source, target, files);
    } else {
      copyIfSafe(source, target, files);
    }
  }
}

function copyIfSafe(source: string, target: string, files: string[], options: { redactSecrets?: boolean } = {}): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile() || !isSafeSnapshotSource(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (options.redactSecrets) {
    const redacted = redactSnapshotSecrets(fs.readFileSync(source, "utf8"));
    fs.writeFileSync(target, redacted, "utf8");
  } else {
    fs.copyFileSync(source, target);
  }
  files.push(path.relative(path.dirname(path.dirname(target)), target).replaceAll("\\", "/"));
}
