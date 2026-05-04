import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb, getDb } from "../db/index.js";
import { panicLog } from "../db/schema.js";
import {
  getPanicState,
  activatePanic,
  deactivatePanic,
  loadPanicStateFromDb,
  _resetPanicForTesting,
} from "./index.js";

const tempDirs: string[] = [];
let currentDbPath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-panic-test-"));
  tempDirs.push(dir);
  currentDbPath = path.join(dir, "test.db");
  initDb(currentDbPath);
  _resetPanicForTesting();
});

afterEach(() => {
  closeDb();
  _resetPanicForTesting();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("panic module", () => {
  it("starts inactive", () => {
    expect(getPanicState().active).toBe(false);
    expect(getPanicState().activatedAt).toBeUndefined();
  });

  it("activates and reports active state", async () => {
    await activatePanic("test reason");
    expect(getPanicState().active).toBe(true);
    expect(getPanicState().activatedAt).toBeDefined();
  });

  it("deactivates after activation", async () => {
    await activatePanic("test reason");
    await deactivatePanic();
    expect(getPanicState().active).toBe(false);
    expect(getPanicState().activatedAt).toBeUndefined();
  });

  it("loadPanicStateFromDb restores active panic across a restart", async () => {
    await activatePanic("simulated crash");
    // Simulate restart: reset in-memory state without closing DB.
    _resetPanicForTesting();
    expect(getPanicState().active).toBe(false); // Sanity: in-memory cleared.

    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(true);
  });

  it("loadPanicStateFromDb restores deactivated state correctly", async () => {
    await activatePanic("test");
    await deactivatePanic();
    _resetPanicForTesting();

    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(false);
  });

  it("loadPanicStateFromDb defaults to inactive when no panic_state row exists", async () => {
    // Fresh DB has a default inactive row from migration; this still returns inactive.
    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(false);
  });

  it("panic active state survives DB close/reopen/reload", async () => {
    await activatePanic("survival test");
    closeDb();
    initDb(currentDbPath);
    _resetPanicForTesting();

    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(true);
    expect(getPanicState().activatedAt).toBeDefined();
  });

  it("panic inactive state survives DB close/reopen/reload", async () => {
    await activatePanic("temp");
    await deactivatePanic();
    closeDb();
    initDb(currentDbPath);
    _resetPanicForTesting();

    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(false);
  });

  it("loadPanicStateFromDb does not infer active state from panic_log entries", async () => {
    // Insert a panic_activated entry directly into panic_log WITHOUT calling activatePanic()
    // (so panic_state remains at its default inactive value).
    const db = getDb();
    await db.insert(panicLog).values({
      id: "injected-audit-entry",
      event: JSON.stringify({ type: "panic_activated", reason: "injected" }),
      createdAt: new Date().toISOString(),
    });

    _resetPanicForTesting();
    await loadPanicStateFromDb();

    // panic_state says inactive — panic_log must not override it.
    expect(getPanicState().active).toBe(false);
  });
});
