import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
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
