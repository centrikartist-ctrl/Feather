import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { panicLog, panicState } from "../db/schema.js";
import type { PanicState } from "@feather/shared";
import { PanicModeError } from "@feather/shared";
import { readGuardLock, removeGuardLock, upsertGuardLock } from "../guard/locks.js";

const PANIC_STATE_ID = "global";

let _panicActive = false;
let _panicActivatedAt: string | undefined;

export function getPanicState(): PanicState {
  const panicLock = readGuardLock("panic.lock");
  if (panicLock.active) {
    return { active: true, activatedAt: panicLock.createdAt ?? _panicActivatedAt };
  }
  return { active: _panicActive, activatedAt: _panicActivatedAt };
}

export function assertNotPanic(): void {
  if (getPanicState().active) {
    throw new PanicModeError();
  }
}

export async function activatePanic(reason = "Manual panic"): Promise<void> {
  _panicActive = true;
  _panicActivatedAt = new Date().toISOString();
  const lock = upsertGuardLock("panic.lock", reason);
  _panicActivatedAt = lock.createdAt ?? _panicActivatedAt;

  const db = getDb();

  // 1. Upsert authoritative panic_state row.
  await db
    .insert(panicState)
    .values({
      id: PANIC_STATE_ID,
      active: true,
      activatedAt: _panicActivatedAt,
      reason,
      updatedAt: _panicActivatedAt,
    })
    .onConflictDoUpdate({
      target: panicState.id,
      set: {
        active: true,
        activatedAt: _panicActivatedAt,
        reason,
        updatedAt: _panicActivatedAt,
      },
    });

  // 2. Insert audit event into panic_log (history only).
  await db.insert(panicLog).values({
    id: nanoid(),
    event: JSON.stringify({ type: "panic_activated", reason }),
    createdAt: _panicActivatedAt,
  });
}

export async function deactivatePanic(): Promise<void> {
  _panicActive = false;
  _panicActivatedAt = undefined;
  removeGuardLock("panic.lock");

  const now = new Date().toISOString();
  const db = getDb();

  // 1. Upsert authoritative panic_state row.
  await db
    .insert(panicState)
    .values({
      id: PANIC_STATE_ID,
      active: false,
      activatedAt: null,
      reason: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: panicState.id,
      set: {
        active: false,
        activatedAt: null,
        reason: null,
        updatedAt: now,
      },
    });

  // 2. Insert audit event into panic_log (history only).
  await db.insert(panicLog).values({
    id: nanoid(),
    event: JSON.stringify({ type: "panic_deactivated" }),
    createdAt: now,
  });
}

/**
 * Restore panic state from the database after a daemon restart.
 * Reads from panic_state (authoritative). Never infers state from panic_log.
 * Must be called once, BEFORE recoverTasksOnStartup, after initDb().
 */
export async function loadPanicStateFromDb(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(panicState)
    .where(eq(panicState.id, PANIC_STATE_ID))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // No row means a fresh DB before migration 0004 ran, or a race.
    // Default to inactive.
    _panicActive = false;
    _panicActivatedAt = undefined;
    return;
  }

  _panicActive = row.active === true;
  _panicActivatedAt = row.activatedAt ?? undefined;
}

/** Reset in-memory panic state. For use in tests only. */
export function _resetPanicForTesting(): void {
  _panicActive = false;
  _panicActivatedAt = undefined;
}
