import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { getDb } from "../db/index.js";
import { ApprovalService } from "../approvals/index.js";
import { ProjectService } from "../projects/index.js";
import { HeartbeatService } from "./index.js";
import { observations } from "../db/schema.js";

let tempDir: string;
let approvals: ApprovalService;
let projects: ProjectService;
let heartbeat: HeartbeatService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-heartbeat-test-"));
  initDb(path.join(tempDir, "test.db"));
  approvals = new ApprovalService();
  projects = new ProjectService();
  heartbeat = new HeartbeatService(projects, approvals);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("HeartbeatService", () => {
  it("creates an observation for pending approvals", async () => {
    const projectRoot = path.join(tempDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "heartbeat-project", rootPath: projectRoot });

    await approvals.createApproval({
      projectId: project.id,
      title: "Need approval",
      reason: "heartbeat test",
      actionType: "shell",
      risk: "review",
      payload: { command: "npm install zod" },
    });

    await heartbeat.run({ manual: true });
    const observations = await heartbeat.getObservations(project.id);

    expect(observations.length).toBeGreaterThan(0);
    expect(observations.some((observation) => observation.title.includes("pending approval"))).toBe(true);
  });

  it("dedupes repeated observations across consecutive runs", async () => {
    const projectRoot = path.join(tempDir, "dedupe-project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "dedupe-project", rootPath: projectRoot });

    await approvals.createApproval({
      projectId: project.id,
      title: "Need approval",
      reason: "heartbeat dedupe",
      actionType: "shell",
      risk: "review",
      payload: {},
    });

    await heartbeat.run({ manual: true });
    await heartbeat.run({ manual: true });

    const projectObservations = await heartbeat.getObservations(project.id);
    expect(projectObservations.filter((observation) => observation.title.includes("pending approval")).length).toBe(1);
  });

  it("prunes observations older than the retention window", async () => {
    const projectRoot = path.join(tempDir, "retention-project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "retention-project", rootPath: projectRoot });

    await getDb().insert(observations).values({
      id: "old-observation",
      projectId: project.id,
      source: "heartbeat",
      severity: "info",
      title: "Old observation",
      body: "stale",
      suggestedActionsJson: "[]",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await heartbeat.run({ manual: true });
    const projectObservations = await heartbeat.getObservations(project.id);
    expect(projectObservations.some((observation) => observation.id === "old-observation")).toBe(false);
  });
});