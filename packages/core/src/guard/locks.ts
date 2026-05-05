import fs from "node:fs";
import path from "node:path";
import { getFeatherHomeDir } from "../config/index.js";

export const GUARD_LOCK_NAMES = [
  "panic.lock",
  "maintenance.lock",
  "update.lock",
  "safe-mode.lock",
] as const;

export type GuardLockName = (typeof GUARD_LOCK_NAMES)[number];

export type GuardLockState = {
  active: boolean;
  path: string;
  createdAt?: string;
  reason?: string;
};

export type GuardLocksState = Record<GuardLockName, GuardLockState>;

export function getLocksDir(): string {
  return path.join(getFeatherHomeDir(), "locks");
}

export function getGuardLockPath(lockName: GuardLockName): string {
  return path.join(getLocksDir(), lockName);
}

export function readGuardLock(lockName: GuardLockName): GuardLockState {
  const lockPath = getGuardLockPath(lockName);
  if (!fs.existsSync(lockPath)) {
    return { active: false, path: lockPath };
  }

  const stat = fs.statSync(lockPath);
  const raw = fs.readFileSync(lockPath, "utf8").trim();
  const fallbackCreatedAt = stat.mtime.toISOString();
  if (!raw) {
    return { active: true, path: lockPath, createdAt: fallbackCreatedAt };
  }

  try {
    const parsed = JSON.parse(raw) as { createdAt?: unknown; reason?: unknown };
    return {
      active: true,
      path: lockPath,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : fallbackCreatedAt,
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return { active: true, path: lockPath, createdAt: fallbackCreatedAt, reason: raw.slice(0, 500) };
  }
}

export function readGuardLocks(): GuardLocksState {
  return Object.fromEntries(
    GUARD_LOCK_NAMES.map((lockName) => [lockName, readGuardLock(lockName)]),
  ) as GuardLocksState;
}

export function writeGuardLock(lockName: GuardLockName, reason: string): GuardLockState {
  const lockPath = getGuardLockPath(lockName);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const createdAt = new Date().toISOString();
  fs.writeFileSync(lockPath, `${JSON.stringify({ createdAt, reason }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { active: true, path: lockPath, createdAt, reason };
}

export function upsertGuardLock(lockName: GuardLockName, reason: string): GuardLockState {
  const existing = readGuardLock(lockName);
  if (existing.active) {
    return existing;
  }
  return writeGuardLock(lockName, reason);
}

export function removeGuardLock(lockName: GuardLockName): void {
  const lockPath = getGuardLockPath(lockName);
  if (fs.existsSync(lockPath)) {
    fs.rmSync(lockPath, { force: true });
  }
}
