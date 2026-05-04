import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "./db/index.js";
import { ProjectService } from "./projects/index.js";
import { ApprovalService } from "./approvals/index.js";
import { BudgetService } from "./budgets/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { TaskRunner } from "./task-runner/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import { gitStatus } from "./tools/git.js";
import type { ProviderAdapter } from "./providers/adapter.js";
import type { ProviderCapabilities, ProviderEvent, TaskInput } from "@feather/shared";

class FakeProvider implements ProviderAdapter {
  id = "fake-provider";
  name = "Fake Provider";
  type = "test";
  capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: false,
    coding: true,
    reasoning: false,
    costEstimate: false,
    supportsProjectRoot: true,
  };

  async validateConfig() {
    return { ok: true, message: "ok" };
  }

  async *startTask(_input: TaskInput): AsyncIterable<ProviderEvent> {
    yield { type: "text_delta", text: "working" };
    yield { type: "done", summary: "completed" };
  }

  async cancelTask(): Promise<void> {}
}

let tempDir: string;
let projects: ProjectService;
let approvals: ApprovalService;
let budgets: BudgetService;
let heartbeat: HeartbeatService;
let tasks: TaskRunner;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-smoke-test-"));
  initDb(path.join(tempDir, "test.db"));
  projects = new ProjectService();
  approvals = new ApprovalService();
  budgets = new BudgetService();
  heartbeat = new HeartbeatService(projects, approvals);
  const registry = new ProviderRegistry();
  registry.register(new FakeProvider());
  tasks = new TaskRunner(registry, projects, approvals, budgets);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("smoke flow", () => {
  it("covers project add, git status, task run, approval lifecycle, and heartbeat observation", async () => {
    const projectRoot = path.join(tempDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    await execa("git", ["init"], { cwd: projectRoot });

    const project = await projects.addProject({ name: "smoke-project", rootPath: projectRoot });

    const gitResult = await gitStatus({ projectRoot });
    expect(gitResult.ok).toBe(true);

    const task = await tasks.createTask({
      projectId: project.id,
      title: "Smoke task",
      prompt: "Run the smoke test",
      providerId: "fake-provider",
      createdBy: "cli",
    });
    await tasks.runTask(task.id);

    const approval = await approvals.createApproval({
      taskId: task.id,
      projectId: project.id,
      title: "Approve shell command",
      reason: "smoke test",
      actionType: "shell",
      risk: "review",
      payload: { command: "npm install zod" },
    });
    const resolved = await approvals.resolveApproval(approval.id, "approved", "once");
    expect(resolved.status).toBe("approved");

    const events = await tasks.getTaskEvents(task.id);
    expect(events.some((event) => event.type === "summary")).toBe(true);

    await heartbeat.run({ manual: true });
    const observations = await heartbeat.getObservations(project.id);
    expect(observations.length).toBeGreaterThan(0);
  });
});