import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { panicLog } from "../db/schema.js";
import type { PanicState } from "@feather/shared";
import { PanicModeError } from "@feather/shared";

let _panicActive = false;
let _panicActivatedAt: string | undefined;

export function getPanicState(): PanicState {
  return { active: _panicActive, activatedAt: _panicActivatedAt };
}

export function assertNotPanic(): void {
  if (_panicActive) {
    throw new PanicModeError();
  }
}

export async function activatePanic(reason = "Manual panic"): Promise<void> {
  _panicActive = true;
  _panicActivatedAt = new Date().toISOString();

  const db = getDb();
  await db.insert(panicLog).values({
    id: nanoid(),
    event: JSON.stringify({ type: "panic_activated", reason }),
    createdAt: _panicActivatedAt,
  });
}

export async function deactivatePanic(): Promise<void> {
  _panicActive = false;
  _panicActivatedAt = undefined;

  const db = getDb();
  await db.insert(panicLog).values({
    id: nanoid(),
    event: JSON.stringify({ type: "panic_deactivated" }),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Restore panic state from the database after a daemon restart.
 * Must be called once, BEFORE recoverTasksOnStartup, after initDb().
 */
export async function loadPanicStateFromDb(): Promise<void> {
  const db = getDb();
  // Get the most recent panic log entry
  const rows = await db
    .select()
    .from(panicLog)
    .orderBy(sql`rowid DESC`)
    .limit(1);

  const row = rows[0];
  if (!row) return;

  const event = JSON.parse(row.event) as { type: string; reason?: string };
  if (event.type === "panic_activated") {
    _panicActive = true;
    _panicActivatedAt = row.createdAt;
  } else {
    _panicActive = false;
    _panicActivatedAt = undefined;
  }
}

/** Reset in-memory panic state. For use in tests only. */
export function _resetPanicForTesting(): void {
  _panicActive = false;
  _panicActivatedAt = undefined;
}
