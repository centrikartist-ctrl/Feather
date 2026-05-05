import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDaemon } from "../daemon.js";
import { closeDb } from "../db/index.js";
import { _resetPanicForTesting } from "../panic/index.js";

const tempDirs: string[] = [];

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "feather-guard-api-home-"));
  process.env["FEATHER_HOME_DIR"] = home;
  tempDirs.push(home);
  _resetPanicForTesting();
});

afterEach(() => {
  closeDb();
  _resetPanicForTesting();
  delete process.env["FEATHER_HOME_DIR"];
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("guard API", () => {
  it("returns structured health and noop diagnostics", async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-guard-api-db-"));
    tempDirs.push(dbDir);
    const daemon = await startDaemon({ port: 0, dbPath: path.join(dbDir, "test.db") });
    try {
      const health = await daemon.app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      const healthBody = health.json();
      expect(healthBody.status).toBe("healthy");
      expect(healthBody.checks.database).toBe("ok");
      expect(healthBody.checks.toolRegistry).toBe("ok");

      const diagnostic = await daemon.app.inject({ method: "POST", url: "/diagnostics/noop" });
      expect(diagnostic.statusCode).toBe(200);
      const diagnosticBody = diagnostic.json();
      expect(diagnosticBody.result).toBe("pass");
      expect(diagnosticBody.checks.dbWriteTemp).toBe("pass");
    } finally {
      await daemon.app.close();
    }
  });

  it("queues lifecycle requests without executing them", async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-guard-api-db-"));
    tempDirs.push(dbDir);
    const daemon = await startDaemon({ port: 0, dbPath: path.join(dbDir, "test.db") });
    try {
      const response = await daemon.app.inject({
        method: "POST",
        url: "/lifecycle/requests",
        payload: {
          type: "RESTART_REQUEST",
          requestedBy: "test",
          reason: "unit test",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(fs.existsSync(body.requestPath)).toBe(true);
      expect(body.request.type).toBe("RESTART_REQUEST");
    } finally {
      await daemon.app.close();
    }
  });

  it("rejects unknown lifecycle request types", async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-guard-api-db-"));
    tempDirs.push(dbDir);
    const daemon = await startDaemon({ port: 0, dbPath: path.join(dbDir, "test.db") });
    try {
      const response = await daemon.app.inject({
        method: "POST",
        url: "/lifecycle/requests",
        payload: {
          type: "RUN_SHELL_REQUEST",
          requestedBy: "test",
          reason: "should fail",
          command: "echo no",
        },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await daemon.app.close();
    }
  });
});
