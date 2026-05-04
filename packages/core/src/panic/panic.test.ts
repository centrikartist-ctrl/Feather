import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import {
  getPanicState,
  activatePanic,
  deactivatePanic,
  loadPanicStateFromDb,
  _resetPanicForTesting,
} from "./index.js";

const tempDirs: string[] = [];

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-panic-test-"));
  tempDirs.push(dir);
  initDb(path.join(dir, "test.db"));
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

  it("loadPanicStateFromDb is a no-op when no log entries exist", async () => {
    await loadPanicStateFromDb();
    expect(getPanicState().active).toBe(false);
  });
});
