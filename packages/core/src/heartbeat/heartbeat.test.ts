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
import { saveProjectFileConfig } from "../config/index.js";
import { MemoryService } from "../memories/index.js";

let tempDir: string;
let approvals: ApprovalService;
let projects: ProjectService;
let heartbeat: HeartbeatService;
let memories: MemoryService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-heartbeat-test-"));
  initDb(path.join(tempDir, "test.db"));
  approvals = new ApprovalService();
  projects = new ProjectService();
  memories = new MemoryService();
  heartbeat = new HeartbeatService(projects, approvals, memories);
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

  it("respects off mode and manual mode", async () => {
    const offRoot = path.join(tempDir, "off-project");
    fs.mkdirSync(offRoot, { recursive: true });
    const offProject = await projects.addProject({ name: "off-project", rootPath: offRoot });
    saveProjectFileConfig(offRoot, {
      name: "off-project",
      heartbeat: { enabled: true, mode: "off" },
    });

    await approvals.createApproval({ projectId: offProject.id, title: "Need approval", reason: "off mode", actionType: "shell", risk: "review", payload: {} });
    await heartbeat.run({ manual: true });
    expect(await heartbeat.getObservations(offProject.id)).toHaveLength(0);

    const manualRoot = path.join(tempDir, "manual-project");
    fs.mkdirSync(manualRoot, { recursive: true });
    const manualProject = await projects.addProject({ name: "manual-project", rootPath: manualRoot });
    saveProjectFileConfig(manualRoot, {
      name: "manual-project",
      heartbeat: { enabled: true, mode: "manual", checks: { pending_approvals: { enabled: true, cooldownMinutes: 0 } } },
    });

    await approvals.createApproval({ projectId: manualProject.id, title: "Need approval", reason: "manual mode", actionType: "shell", risk: "review", payload: {} });
    await heartbeat.run();
    expect(await heartbeat.getObservations(manualProject.id)).toHaveLength(0);
    await heartbeat.run({ manual: true });
    expect((await heartbeat.getObservations(manualProject.id)).length).toBeGreaterThan(0);
  });

  it("suppresses scheduled runs during quiet hours and adds proactive suggestions", async () => {
    const quietRoot = path.join(tempDir, "quiet-project");
    fs.mkdirSync(quietRoot, { recursive: true });
    const quietProject = await projects.addProject({ name: "quiet-project", rootPath: quietRoot });
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const end = `${String(now.getHours()).padStart(2, "0")}:${String((now.getMinutes() + 1) % 60).padStart(2, "0")}`;
    saveProjectFileConfig(quietRoot, {
      name: "quiet-project",
      heartbeat: {
        enabled: true,
        mode: "passive",
        quietHours: { start, end },
        checks: { pending_approvals: { enabled: true, cooldownMinutes: 0 } },
      },
    });
    await approvals.createApproval({ projectId: quietProject.id, title: "Need approval", reason: "quiet hours", actionType: "shell", risk: "review", payload: {} });
    await heartbeat.run();
    expect(await heartbeat.getObservations(quietProject.id)).toHaveLength(0);

    const proactiveRoot = path.join(tempDir, "proactive-project");
    fs.mkdirSync(proactiveRoot, { recursive: true });
    const proactiveProject = await projects.addProject({ name: "proactive-project", rootPath: proactiveRoot });
    saveProjectFileConfig(proactiveRoot, {
      name: "proactive-project",
      heartbeat: {
        enabled: true,
        mode: "proactive",
        checks: { pending_approvals: { enabled: true, cooldownMinutes: 0 } },
      },
    });
    await approvals.createApproval({ projectId: proactiveProject.id, title: "Need approval", reason: "proactive", actionType: "shell", risk: "review", payload: {} });
    await heartbeat.run({ manual: true });
    const proactiveObservations = await heartbeat.getObservations(proactiveProject.id);
    expect(proactiveObservations[0]?.suggestedActions.length).toBeGreaterThan(0);
  });

  it("includes heartbeat instructions and explicit memory in recaps", async () => {
    const projectRoot = path.join(tempDir, "recap-project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "recap-project", rootPath: projectRoot });
    saveProjectFileConfig(projectRoot, {
      name: "recap-project",
      heartbeat: {
        enabled: true,
        mode: "passive",
        instructions: ["Only notify about shipping blockers."],
      },
    });
    await memories.create({ scope: "project", projectId: project.id, kind: "constraint", content: "Do not add features during UI passes." });

    const recap = await heartbeat.generateDailyRecap(project.id);
    expect(recap).toContain("Only notify about shipping blockers.");
    expect(recap).toContain("Do not add features during UI passes.");
  });
});