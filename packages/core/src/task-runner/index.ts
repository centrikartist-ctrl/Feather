import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { tasks, taskEvents } from "../db/schema.js";
import type { Task, TaskEvent, TaskStatus, ProviderEvent, Approval, RiskLevel, ToolResult } from "@feather/shared";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProjectService } from "../projects/index.js";
import type { ApprovalService } from "../approvals/index.js";
import type { BudgetService } from "../budgets/index.js";
import { loadProjectFileConfig } from "../config/index.js";
import { buildTaskSystemPrompt } from "../config/index.js";
import { PermissionService } from "../permissions/index.js";
import { readFile, listFiles, prepareWriteFile, commitPreparedWrite, ReadFileInput, ListFilesInput, WriteFileInput } from "../tools/filesystem.js";
import { gitStatus, gitDiff, gitLog, GitDiffInput, GitLogInput } from "../tools/git.js";
import { runCommand, RunCommandInput } from "../tools/shell.js";
import { assertNotPanic } from "../panic/index.js";

export type CreateTaskInput = {
  projectId?: string;
  title: string;
  prompt: string;
  providerId: string;
  createdBy: Task["createdBy"];
  budgetCents?: number;
};

type TaskEventListener = (taskId: string, event: TaskEvent) => void;

type TaskInterrupt = {
  status: TaskStatus;
  message: string;
};

type ActiveTaskState = {
  controller: AbortController;
  providerId: string;
  project?: Awaited<ReturnType<ProjectService["getProject"]>>;
  permissionService?: PermissionService;
  hardTaskLimitCents?: number;
  interrupt?: TaskInterrupt;
};

class TaskInterruptedError extends Error {
  constructor(readonly status: TaskStatus, message: string) {
    super(message);
    this.name = "TaskInterruptedError";
  }
}

export class TaskRunner {
  private listeners = new Set<TaskEventListener>();
  private activeTasks = new Map<string, ActiveTaskState>();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly projects: ProjectService,
    private readonly approvals: ApprovalService,
    private readonly budgets: BudgetService,
  ) {}

  onEvent(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  private emit(taskId: string, event: TaskEvent): void {
    for (const listener of this.listeners) {
      listener(taskId, event);
    }
    void this.persistEvent(taskId, event);
  }

  private async persistEvent(taskId: string, event: TaskEvent): Promise<void> {
    const db = getDb();
    await db.insert(taskEvents).values({
      id: nanoid(),
      taskId,
      eventType: event.type,
      payloadJson: JSON.stringify(event),
      createdAt: new Date().toISOString(),
    });
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(tasks).values({
      id,
      projectId: input.projectId,
      title: input.title,
      prompt: input.prompt,
      status: "queued",
      providerId: input.providerId,
      createdBy: input.createdBy,
      budgetCents: input.budgetCents ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      projectId: input.projectId,
      title: input.title,
      prompt: input.prompt,
      status: "queued",
      providerId: input.providerId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  async runTask(taskId: string): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const project = row.projectId
      ? await this.projects.getProject(row.projectId)
      : undefined;

    const permissionService = project
      ? new PermissionService(project.rootPath, loadProjectFileConfig(project.rootPath))
      : undefined;

    const hardTaskLimitCents = await this.budgets.getTaskHardLimitCents(
      row.projectId ?? undefined,
      row.budgetCents ?? undefined,
    );

    const state: ActiveTaskState = {
      controller: new AbortController(),
      providerId: row.providerId,
      project,
      permissionService,
      hardTaskLimitCents,
    };

    this.activeTasks.set(taskId, state);

    try {
      assertNotPanic();
      await this.budgets.checkDailyBudget(row.projectId ?? undefined);
      if (row.budgetCents !== null && row.budgetCents !== undefined) {
        await this.budgets.checkTaskBudget(row.projectId ?? undefined, row.budgetCents);
      }

      await this.updateTaskStatus(taskId, "running");

      const provider = this.providers.get(row.providerId);

      this.emit(taskId, {
        type: "message",
        role: "user",
        content: row.prompt,
      });

      const systemPrompt = buildTaskSystemPrompt({ projectRoot: project?.rootPath });

      for await (const event of provider.startTask({
        taskId,
        project,
        prompt: row.prompt,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(row.budgetCents !== null && row.budgetCents !== undefined ? { budgetCents: row.budgetCents } : {}),
        signal: state.controller.signal,
      })) {
        this.throwIfInterrupted(taskId, state);
        await this.handleProviderEvent(taskId, state, provider.id, event);
      }

      this.throwIfInterrupted(taskId, state);
      await this.updateTaskStatus(taskId, "completed");
    } catch (err) {
      if (err instanceof TaskInterruptedError) {
        this.emit(taskId, { type: "error", message: err.message });
        await this.updateTaskStatus(taskId, err.status);
      } else {
        this.emit(taskId, { type: "error", message: String(err) });
        await this.updateTaskStatus(taskId, "failed");
      }
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  async recoverTasksOnStartup(): Promise<{ keptQueued: number; cancelledRunning: number; pendingApproval: number }> {
    const db = getDb();
    const rows = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ["queued", "running", "awaiting_approval"]));

    let keptQueued = 0;
    let cancelledRunning = 0;
    let pendingApproval = 0;

    for (const row of rows) {
      if (this.activeTasks.has(row.id)) {
        continue;
      }

      if (row.status === "queued") {
        // Conservative: do NOT auto-run queued tasks on restart. Leave them queued for manual trigger.
        this.emit(row.id, {
          type: "message",
          role: "system",
          content: "Task was queued when the daemon restarted. It remains queued and will not auto-run. Trigger it manually to resume.",
        });
        keptQueued += 1;
        continue;
      }

      if (row.status === "running") {
        // Mark as cancelled — we cannot safely resume mid-execution.
        await this.updateTaskStatus(row.id, "cancelled");
        this.emit(row.id, {
          type: "error",
          message: "Task was running when the daemon restarted and has been marked cancelled. No work was auto-resumed.",
        });
        cancelledRunning += 1;
        continue;
      }

      // awaiting_approval — leave the task in place; the approval resolver handles restart.
      this.emit(row.id, {
        type: "message",
        role: "system",
        content: "Task was awaiting approval when the daemon restarted. Resolving the approval will restart it from its saved prompt.",
      });
      pendingApproval += 1;
    }

    return { keptQueued, cancelledRunning, pendingApproval };
  }

  async handleRecoveredApprovalResolution(approval: Approval): Promise<boolean> {
    if (!approval.taskId || this.activeTasks.has(approval.taskId)) {
      return false;
    }

    const task = await this.getTask(approval.taskId);
    if (!task || task.status !== "awaiting_approval") {
      return false;
    }

    if (approval.status === "approved") {
      await this.updateTaskStatus(task.id, "queued");
      this.emit(task.id, {
        type: "message",
        role: "system",
        content: "Approval was resolved after a daemon restart. Restarting the task from its saved prompt.",
      });
      void this.runTask(task.id);
      return true;
    }

    if (approval.status === "rejected") {
      this.emit(task.id, {
        type: "error",
        message: `Task remained blocked after restart because approval ${approval.id} was rejected.`,
      });
      await this.updateTaskStatus(task.id, "blocked");
      return true;
    }

    return false;
  }

  async cancelTask(taskId: string, reason: "cancelled" | "panic" = "cancelled"): Promise<void> {
    const state = this.activeTasks.get(taskId);
    if (!state) {
      await this.updateTaskStatus(taskId, "cancelled");
      this.emit(taskId, {
        type: "error",
        message: reason === "panic" ? "Task interrupted by panic mode." : "Task cancelled by user.",
      });
      return;
    }

    state.interrupt = {
      status: "cancelled",
      message: reason === "panic" ? "Task interrupted by panic mode." : "Task cancelled by user.",
    };
    state.controller.abort();

    try {
      await this.providers.get(state.providerId).cancelTask(taskId);
    } catch {
      // Best effort; cancellation can still succeed via local abort + late-event suppression.
    }
  }

  async cancelAllActive(reason: "cancelled" | "panic" = "cancelled"): Promise<void> {
    for (const taskId of this.activeTasks.keys()) {
      await this.cancelTask(taskId, reason);
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    const db = getDb();
    const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToTask(row);
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    const db = getDb();
    const rows = projectId
      ? await db.select().from(tasks).where(eq(tasks.projectId, projectId))
      : await db.select().from(tasks);
    return rows.map(rowToTask);
  }

  async getTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId));
    return rows.map((r) => JSON.parse(r.payloadJson) as TaskEvent);
  }

  private throwIfInterrupted(taskId: string, state: ActiveTaskState): void {
    if (state.controller.signal.aborted && !state.interrupt) {
      state.interrupt = { status: "cancelled", message: "Task cancelled." };
    }
    if (state.interrupt) {
      throw new TaskInterruptedError(state.interrupt.status, state.interrupt.message);
    }

    try {
      assertNotPanic();
    } catch {
      state.interrupt = { status: "cancelled", message: "Task interrupted by panic mode." };
      void this.cancelTask(taskId, "panic");
      throw new TaskInterruptedError("cancelled", state.interrupt.message);
    }
  }

  private async handleProviderEvent(
    taskId: string,
    state: ActiveTaskState,
    providerId: string,
    event: ProviderEvent,
  ): Promise<void> {
    this.emit(taskId, { type: "provider_event", providerId, event });

    switch (event.type) {
      case "text_delta": {
        this.emit(taskId, { type: "message", role: "assistant", content: event.text });
        return;
      }
      case "file_diff": {
        this.emit(taskId, { type: "diff", path: event.path, diff: event.diff });
        return;
      }
      case "command_output": {
        this.emit(taskId, { type: "command_output", command: event.command, stdout: event.output });
        return;
      }
      case "cost_estimate": {
        await this.handleCostEstimate(taskId, state, providerId, event);
        return;
      }
      case "tool_request": {
        await this.handleToolRequest(taskId, state, event.toolName, event.input);
        return;
      }
      case "approval_request": {
        await this.handleApprovalRequest(taskId, state, event.payload);
        return;
      }
      case "done": {
        this.emit(taskId, { type: "summary", content: event.summary });
        return;
      }
      case "error": {
        throw new Error(event.error);
      }
      default: {
        return;
      }
    }
  }

  private async handleCostEstimate(
    taskId: string,
    state: ActiveTaskState,
    providerId: string,
    event: Extract<ProviderEvent, { type: "cost_estimate" }>,
  ): Promise<void> {
    await this.budgets.recordCost({
      taskId,
      projectId: state.project?.id,
      providerId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      estimatedCents: event.estimatedCents,
    });

    if (state.hardTaskLimitCents !== undefined) {
      // Use cumulative task spend so many small events can trigger the limit.
      const taskSpend = await this.budgets.getTaskSpendCents(taskId);
      if (taskSpend >= state.hardTaskLimitCents) {
        state.interrupt = {
          status: "cancelled",
          message: "Task interrupted: estimated spend exceeded task budget.",
        };
        throw new TaskInterruptedError(state.interrupt.status, state.interrupt.message);
      }
    }
  }

  private async handleToolRequest(
    taskId: string,
    state: ActiveTaskState,
    toolName: string,
    input: unknown,
  ): Promise<void> {
    const tool = this.prepareToolRequest(state, toolName, input);
    const actionId = nanoid();

    this.emit(taskId, {
      type: "tool_call_requested",
      toolId: toolName,
      actionId,
      input,
      risk: tool.risk,
    });

    if (tool.risk === "safe") {
      const result = await tool.execute();
      if (result.diff) {
        this.emit(taskId, { type: "diff", path: extractPathFromInput(input), diff: result.diff });
      }
      this.emit(taskId, { type: "tool_result", toolId: toolName, actionId, output: result.output ?? result.error ?? null });
      if (!result.ok) {
        throw new Error(result.error ?? `Tool failed: ${toolName}`);
      }
      return;
    }

    const approval = await this.approvals.createApproval({
      taskId,
      projectId: state.project?.id,
      title: tool.title,
      reason: tool.reason,
      actionType: tool.actionType,
      risk: tool.risk,
      payload: tool.approvalPayload ?? {
        toolName,
        input,
      },
    });

    this.emit(taskId, { type: "approval_requested", approvalId: approval.id });
    await this.updateTaskStatus(taskId, "awaiting_approval");

    const resolved = await this.approvals.waitForResolution(approval.id, state.controller.signal);
    this.emit(taskId, { type: "approval_resolved", approvalId: approval.id, decision: resolved.status === "approved" ? "approved" : "rejected" });

    if (resolved.status !== "approved") {
      throw new TaskInterruptedError("blocked", `${tool.title} was rejected.`);
    }

    this.throwIfInterrupted(taskId, state);
    await this.updateTaskStatus(taskId, "running");
    const result = await tool.execute();
    if (result.diff) {
      this.emit(taskId, { type: "diff", path: extractPathFromInput(input), diff: result.diff });
    }
    this.emit(taskId, { type: "tool_result", toolId: toolName, actionId, output: result.output ?? result.error ?? null });
    if (!result.ok) {
      throw new Error(result.error ?? `Tool failed: ${toolName}`);
    }
  }

  private async handleApprovalRequest(taskId: string, state: ActiveTaskState, payload: unknown): Promise<void> {
    const details = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const title = typeof details["title"] === "string" ? details["title"] : "Provider approval required";
    const reason = typeof details["reason"] === "string" ? details["reason"] : "Provider requested approval before continuing.";
    const risk = normalizeRisk(details["risk"]);

    const approval = await this.approvals.createApproval({
      taskId,
      projectId: state.project?.id,
      title,
      reason,
      actionType: "provider",
      risk,
      payload,
    });

    this.emit(taskId, { type: "approval_requested", approvalId: approval.id });
    await this.updateTaskStatus(taskId, "awaiting_approval");

    const resolved = await this.approvals.waitForResolution(approval.id, state.controller.signal);
    this.emit(taskId, { type: "approval_resolved", approvalId: approval.id, decision: resolved.status === "approved" ? "approved" : "rejected" });

    if (resolved.status !== "approved") {
      throw new TaskInterruptedError("blocked", `${title} was rejected.`);
    }

    await this.updateTaskStatus(taskId, "running");
  }

  private prepareToolRequest(state: ActiveTaskState, toolName: string, rawInput: unknown): {
    title: string;
    reason: string;
    actionType: Approval["actionType"];
    risk: RiskLevel;
    /** Override the default approval payload. Used to inject diff previews for file writes. */
    approvalPayload?: Record<string, unknown>;
    execute: () => Promise<ToolResult>;
  } {
    const projectRoot = state.project?.rootPath;
    const permissions = state.permissionService;

    switch (toolName) {
      case "shell.run":
      case "shell.runCommand": {
        const input = RunCommandInput.parse(rawInput);
        const fullCommand = [input.command, ...(input.args ?? [])].join(" ");
        const check = permissions?.checkShellCommand(fullCommand);
        if (check && !check.allowed) {
          throw new TaskInterruptedError("blocked", `Blocked shell command: ${check.reason ?? fullCommand}`);
        }
        return {
          title: `Run shell command: ${fullCommand}`,
          reason: check?.reason ?? "Provider requested shell execution.",
          actionType: "shell",
          // Default to "review" when no permissions service: unknown shell commands should not auto-execute.
          risk: check?.requiresApproval ? "review" : (permissions !== undefined ? "safe" : "review"),
          // approvalResolved: true because task-runner is the sole approval authority.
          execute: () => runCommand(input, { projectRoot, permissions, approvalResolved: true }),
        };
      }
      case "filesystem.readFile": {
        const input = ReadFileInput.parse(rawInput);
        return {
          title: `Read file: ${input.path}`,
          reason: "Provider requested a file read.",
          actionType: "filesystem",
          risk: "safe",
          execute: () => readFile(input, { projectRoot, permissions }),
        };
      }
      case "filesystem.listFiles": {
        const input = ListFilesInput.parse(rawInput);
        return {
          title: `List files: ${input.path}`,
          reason: "Provider requested a directory listing.",
          actionType: "filesystem",
          risk: "safe",
          execute: () => listFiles(input, { projectRoot, permissions }),
        };
      }
      case "filesystem.writeFile": {
        const input = WriteFileInput.parse(rawInput);
        const check = permissions?.checkFilesystemWrite(input.path);
        if (check && !check.allowed && check.risk === "blocked") {
          throw new TaskInterruptedError("blocked", `Blocked file write: ${check.reason ?? input.path}`);
        }
        // Prepare write eagerly to capture diff for the approval preview (P4).
        const prepared = prepareWriteFile(input, { projectRoot, permissions });
        return {
          title: `Write file: ${input.path}`,
          reason: check?.reason ?? "Provider requested a file write.",
          actionType: "filesystem",
          risk: check?.risk ?? "review",
          // Approval payload includes the diff so the reviewer sees exactly what will change.
          approvalPayload: {
            toolName: "filesystem.writeFile",
            input: { path: input.path, contentLength: prepared.contentLength },
            preview: {
              diff: prepared.diff,
              isNewFile: prepared.isNewFile,
              previousHash: prepared.previousHash,
              nextHash: prepared.nextHash,
            },
          },
          // commitPreparedWrite verifies the file hasn't changed since prepare, then writes.
          execute: () => Promise.resolve(commitPreparedWrite(prepared, { projectRoot, permissions, approvalResolved: true })),
        };
      }
      case "git.status": {
        if (!projectRoot) {
          throw new TaskInterruptedError("blocked", "Git status requires a project root.");
        }
        return {
          title: "Run git status",
          reason: "Provider requested repository status.",
          actionType: "git",
          risk: "safe",
          execute: () => gitStatus({ projectRoot }),
        };
      }
      case "git.diff": {
        if (!projectRoot) {
          throw new TaskInterruptedError("blocked", "Git diff requires a project root.");
        }
        const input = GitDiffInput.parse(rawInput);
        return {
          title: `Run git diff${input.filePath ? ` for ${input.filePath}` : ""}`,
          reason: "Provider requested repository diff output.",
          actionType: "git",
          risk: "safe",
          execute: () => gitDiff(input, { projectRoot }),
        };
      }
      case "git.log": {
        if (!projectRoot) {
          throw new TaskInterruptedError("blocked", "Git log requires a project root.");
        }
        const input = GitLogInput.parse(rawInput ?? {});
        return {
          title: "Run git log",
          reason: "Provider requested recent git history.",
          actionType: "git",
          risk: "safe",
          execute: () => gitLog(input, { projectRoot }),
        };
      }
      default:
        throw new TaskInterruptedError("blocked", `Unsupported tool request: ${toolName}`);
    }
  }

  private async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const db = getDb();
    await db
      .update(tasks)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, taskId));
  }
}

function normalizeRisk(value: unknown): RiskLevel {
  if (value === "safe" || value === "review" || value === "dangerous" || value === "blocked") {
    return value;
  }
  return "review";
}



function extractPathFromInput(input: unknown): string {
  if (typeof input === "object" && input !== null && "path" in input && typeof (input as Record<string, unknown>)["path"] === "string") {
    return (input as Record<string, unknown>)["path"] as string;
  }
  return "";
}

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    title: row.title,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    providerId: row.providerId,
    createdBy: row.createdBy as Task["createdBy"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
