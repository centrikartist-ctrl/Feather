import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, getDb, initDb } from "../db/index.js";
import { approvals } from "../db/schema.js";
import { ApprovalService } from "./index.js";
import { ApprovalRequiredError } from "@feather/shared";
import { activatePanic, deactivatePanic } from "../panic/index.js";

let tempDir: string;
let svc: ApprovalService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-approval-test-"));
  process.env["FEATHER_HOME_DIR"] = path.join(tempDir, "home");
  initDb(path.join(tempDir, "test.db"));
  svc = new ApprovalService();
});

afterEach(async () => {
  await deactivatePanic();
  closeDb();
  delete process.env["FEATHER_HOME_DIR"];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("ApprovalService", () => {
  it("creates a pending approval", async () => {
    const approval = await svc.createApproval({
      title: "Run npm install",
      reason: "Adding a dependency",
      actionType: "shell",
      risk: "review",
      payload: { command: "npm install zod" },
    });

    expect(approval.status).toBe("pending");
    expect(approval.risk).toBe("review");
    expect(approval.id).toBeTruthy();
  });

  it("resolves an approval as approved", async () => {
    const approval = await svc.createApproval({
      title: "Write to src/",
      reason: "Create new file",
      actionType: "filesystem",
      risk: "review",
      payload: {},
    });

    const resolved = await svc.resolveApproval(approval.id, "approved", "once");
    expect(resolved.status).toBe("approved");
    expect(resolved.approvedScope).toBe("once");
  });

  it("resolves an approval as rejected", async () => {
    const approval = await svc.createApproval({
      title: "Git push",
      reason: "Deploy",
      actionType: "git",
      risk: "review",
      payload: {},
    });

    const resolved = await svc.resolveApproval(approval.id, "rejected");
    expect(resolved.status).toBe("rejected");
  });

  it("throws ApprovalRequiredError from requireApproval", async () => {
    await expect(
      svc.requireApproval({
        title: "Risky action",
        reason: "test",
        actionType: "shell",
        risk: "dangerous",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("lists pending approvals", async () => {
    await svc.createApproval({ title: "A", reason: "r", actionType: "shell", risk: "review", payload: {} });
    await svc.createApproval({ title: "B", reason: "r", actionType: "filesystem", risk: "safe", payload: {} });

    const pending = await svc.getPendingApprovals();
    expect(pending.length).toBe(2);
    expect(pending.every((a: { status: string }) => a.status === "pending")).toBe(true);
  });

  it("does not list resolved approvals in pending", async () => {
    const a = await svc.createApproval({ title: "A", reason: "r", actionType: "shell", risk: "review", payload: {} });
    await svc.resolveApproval(a.id, "approved");

    const pending = await svc.getPendingApprovals();
    expect(pending.length).toBe(0);
  });

  it("throws when resolving already resolved approval", async () => {
    const a = await svc.createApproval({ title: "A", reason: "r", actionType: "shell", risk: "review", payload: {} });
    await svc.resolveApproval(a.id, "approved");

    await expect(svc.resolveApproval(a.id, "rejected")).rejects.toThrow();
  });

  it("blocks approval during panic mode but still allows rejection", async () => {
    const approval = await svc.createApproval({ title: "A", reason: "r", actionType: "shell", risk: "review", payload: {} });
    await activatePanic("test");

    await expect(svc.resolveApproval(approval.id, "approved")).rejects.toThrow();
    await expect(svc.resolveApproval(approval.id, "rejected")).resolves.toMatchObject({ status: "rejected" });
  });

  it("expires approvals older than the cutoff", async () => {
    const approval = await svc.createApproval({ title: "Old", reason: "r", actionType: "shell", risk: "review", payload: {} });
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await getDb().update(approvals).set({ createdAt: oldDate }).where(eq(approvals.id, approval.id));
    await svc.expireOldApprovals(24);

    const pending = await svc.getPendingApprovals();
    expect(pending).toHaveLength(0);
  });
});
