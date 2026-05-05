import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertGuardLock } from "@feather/core";
import { FeatherSupervisor } from "./supervisor.js";
import type { SupervisorConfig } from "./config.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-supervisor-test-"));
  process.env["FEATHER_HOME_DIR"] = path.join(tempDir, "home");
});

afterEach(() => {
  delete process.env["FEATHER_HOME_DIR"];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("FeatherSupervisor", () => {
  it("does not restart while safe-mode.lock exists", async () => {
    upsertGuardLock("safe-mode.lock", "unit test");
    const supervisor = new FeatherSupervisor(makeConfig(), tempDir);

    const state = await supervisor.tick();

    expect(state.classification).toBe("safe_mode");
    expect(state.restartAttempts).toBe(0);
  });
});

function makeConfig(): SupervisorConfig {
  return {
    gatewayUrl: "http://127.0.0.1:9",
    pollIntervalMs: 1,
    requestTimeoutMs: 50,
    restartFailureThreshold: 1,
    safeModeFailureThreshold: 2,
    restart: {
      enabled: true,
      command: process.execPath,
      args: ["--version"],
    },
    featherHomeDir: process.env["FEATHER_HOME_DIR"]!,
    snapshotsDir: path.join(tempDir, "snapshots"),
    requestsDir: path.join(tempDir, "requests"),
  };
}
