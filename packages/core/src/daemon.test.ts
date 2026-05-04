import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startDaemon } from "./daemon.js";
import { closeDb, getDb, initDb } from "./db/index.js";
import { approvals, taskEvents, tasks } from "./db/schema.js";
import { activatePanic, _resetPanicForTesting } from "./panic/index.js";

const tempDirs: string[] = [];

beforeEach(() => {
  _resetPanicForTesting();
});

afterEach(() => {
  closeDb();
  _resetPanicForTesting();
  delete process.env["TELEGRAM_BOT_TOKEN"];
  delete process.env["TELEGRAM_ALLOWED_USER_IDS"];
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("startDaemon", () => {
  it("skips recovery and leaves heartbeat stopped when panic mode is active", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-daemon-test-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "daemon.db");

    initDb(dbPath);
    const db = getDb();
    const now = new Date().toISOString();

    await db.insert(tasks).values([
      {
        id: "queued-task",
        title: "queued",
        prompt: "queued prompt",
        status: "queued",
        providerId: "missing-provider",
        createdBy: "cli",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "running-task",
        title: "running",
        prompt: "running prompt",
        status: "running",
        providerId: "missing-provider",
        createdBy: "cli",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "approval-task",
        title: "approval",
        prompt: "approval prompt",
        status: "awaiting_approval",
        providerId: "missing-provider",
        createdBy: "cli",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(approvals).values({
      id: "pending-approval",
      taskId: "approval-task",
      projectId: null,
      title: "Pending approval",
      reason: "startup test",
      actionType: "filesystem",
      risk: "review",
      payloadJson: JSON.stringify({ toolName: "filesystem.writeFile", input: { path: "notes.txt" } }),
      status: "pending",
      approvedScope: null,
      createdAt: now,
      resolvedAt: null,
    });

    await activatePanic("test startup panic");
    closeDb();
    _resetPanicForTesting();

    const daemon = await startDaemon({ dbPath, port: 0 });

    try {
      const queued = await daemon.tasks.getTask("queued-task");
      const running = await daemon.tasks.getTask("running-task");
      const awaitingApproval = await daemon.tasks.getTask("approval-task");
      const emittedEvents = await getDb().select().from(taskEvents);

      expect(queued?.status).toBe("queued");
      expect(running?.status).toBe("running");
      expect(awaitingApproval?.status).toBe("awaiting_approval");
      expect(emittedEvents).toHaveLength(0);
      expect((daemon.heartbeat as any).intervalHandle).toBeNull();
    } finally {
      await daemon.app.close();
      closeDb();
    }
  });
});