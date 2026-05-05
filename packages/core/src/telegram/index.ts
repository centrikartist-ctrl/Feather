/**
 * Telegram bot connector for Feather.
 *
 * Uses the Telegram Bot API via long-polling (no external library needed).
 * Optional feature — only starts if TELEGRAM_BOT_TOKEN env var is set
 * and allowed_user_ids are configured.
 *
 * Commands:
 *   /status          - Daemon status + panic state
 *   /projects        - List registered projects
 *   /task <project> <prompt>  - Create a task
 *   /approvals       - List pending approvals
 *   /approve <id>    - Approve an action (once scope)
 *   /reject <id>     - Reject an action
 *   /recap <project> - Daily recap
 *   /heartbeat <project> on|off - Toggle heartbeat
 *   /budget          - Daily spend
 *   /panic           - Activate panic mode (cancels all tasks)
 *   /resume confirm  - Deactivate panic mode
 *   /cancel <taskId> - Cancel a specific task
 *   /actions         - Grouped operator command reference
 *   /menu            - Alias for /actions
 *   /examples        - Copyable slash + freeform examples
 *   /help            - Command reference
 */

import https from "node:https";
import { nanoid } from "nanoid";
import type { Approval, Observation, Project, Task } from "@feather/shared";
import type { ApprovalService } from "../approvals/index.js";
import type { ProjectService } from "../projects/index.js";
import type { TaskRunner } from "../task-runner/index.js";
import type { BudgetService } from "../budgets/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { MemoryService } from "../memories/index.js";
import type { SkillService } from "../skills/index.js";
import { getPanicState, activatePanic, deactivatePanic } from "../panic/index.js";
import { resolveTaskProviderId } from "../providers/routing.js";

export type TelegramConfig = {
  botToken: string;
  allowedUserIds: number[];
  globalDefaultProviderId?: string;
  allowSingleProviderAutoRoute?: boolean;
  freeform?: {
    enabled?: boolean;
    confirmations?: {
      readOnly?: boolean;
      createTask?: boolean;
    };
  };
  /** @deprecated Use globalDefaultProviderId. */
  defaultProviderId?: string;
};

export type TelegramFreeformIntent =
  | { type: "read_only_question"; projectId?: string; question: string }
  | { type: "create_task"; projectId?: string; prompt: string; risk: "safe" | "review" }
  | { type: "approval_response"; decision: "approve" | "reject"; approvalId?: string }
  | { type: "panic" }
  | { type: "cancel_task"; taskId?: string }
  | { type: "unknown"; message: string };

export type PendingTelegramConfirmation = {
  id: string;
  chatId: number;
  userId: number;
  type: "create_task";
  projectId?: string;
  providerId?: string;
  prompt: string;
  createdAt: string;
  expiresAt: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
};

type TelegramServices = {
  approvals: ApprovalService;
  projects: ProjectService;
  tasks: TaskRunner;
  budgets: BudgetService;
  heartbeat: HeartbeatService;
  providers: ProviderRegistry;
  memories: MemoryService;
  skills: SkillService;
};

type TelegramTransport = {
  getUpdates: (offset: number) => Promise<TelegramUpdate[]>;
  sendMessage: (chatId: number, text: string) => Promise<void>;
};

const FREEFORM_CREATE_TASK_KEYWORDS = ["fix", "change", "update", "edit", "build", "install", "commit", "push", "write", "create file", "create", "run"];
const FREEFORM_READ_ONLY_KEYWORDS = ["status", "what's going on", "whats going on", "check", "summarise", "summarize", "recap", "pending approvals", "projects", "what should i work on"];
const CREATE_TASK_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export function classifyTelegramFreeformIntent(message: string, options: { projects: Project[]; pendingApprovals: Approval[] }): TelegramFreeformIntent {
  const normalized = normalizeTelegramText(message);
  const approvalIdMatch = normalized.match(/^(approve|reject)\s+([a-z0-9_-]+)$/i);
  if (normalized === "panic" || normalized === "stop everything" || normalized === "emergency stop") {
    return { type: "panic" };
  }

  const cancelMatch = normalized.match(/^(cancel|stop task)\s+([a-z0-9_-]+)$/i);
  if (cancelMatch?.[2]) {
    return { type: "cancel_task", taskId: cancelMatch[2] };
  }

  if (approvalIdMatch?.[1]) {
    return {
      type: "approval_response",
      decision: approvalIdMatch[1].toLowerCase() === "approve" ? "approve" : "reject",
      approvalId: approvalIdMatch[2],
    };
  }

  if (normalized === "approve" || normalized === "reject") {
    const pendingApprovals = options.pendingApprovals;
    return {
      type: "approval_response",
      decision: normalized === "approve" ? "approve" : "reject",
      approvalId: pendingApprovals.length === 1 ? pendingApprovals[0]?.id : undefined,
    };
  }

  if (FREEFORM_READ_ONLY_KEYWORDS.some((keyword) => normalized === keyword || normalized.includes(keyword))) {
    const project = findProjectMention(options.projects, normalized);
    return { type: "read_only_question", question: message.trim(), projectId: project?.id };
  }

  if (FREEFORM_CREATE_TASK_KEYWORDS.some((keyword) => normalized === keyword || normalized.startsWith(`${keyword} `) || normalized.includes(` ${keyword} `))) {
    const project = findProjectMention(options.projects, normalized);
    return { type: "create_task", prompt: message.trim(), projectId: project?.id, risk: "review" };
  }

  return { type: "unknown", message: message.trim() };
}

function normalizeTelegramText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function findProjectMention(projects: Project[], normalizedMessage: string): Project | undefined {
  return projects.find((project) => {
    const normalizedName = project.name.trim().toLowerCase();
    const normalizedId = project.id.trim().toLowerCase();
    return normalizedMessage.includes(normalizedName) || normalizedMessage.includes(normalizedId);
  });
}

function telegramRequest(token: string, method: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${token}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  const result = await telegramRequest(token, "getUpdates", {
    offset,
    timeout: 20,
    allowed_updates: ["message"],
  }) as { ok: boolean; result: TelegramUpdate[]; description?: string; error_code?: number };
  if (!result.ok) {
    throw new Error(result.description ?? `Telegram API error (${result.error_code ?? "unknown"})`);
  }
  return result?.result ?? [];
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });
}

export class TelegramConnector {
  private config: TelegramConfig;
  private services: TelegramServices;
  private transport: TelegramTransport;
  private offset = 0;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private lastPollError = "";
  private pendingConfirmations = new Map<string, PendingTelegramConfirmation>();

  constructor(config: TelegramConfig, services: TelegramServices, transport?: Partial<TelegramTransport>) {
    this.config = config;
    this.services = services;
    this.transport = {
      getUpdates: transport?.getUpdates ?? ((offset) => getUpdates(this.config.botToken, offset)),
      sendMessage: transport?.sendMessage ?? ((chatId, text) => sendMessage(this.config.botToken, chatId, text)),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isAllowedUser(userId?: number): boolean {
    return Boolean(userId && this.config.allowedUserIds.includes(userId));
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const updates = await this.transport.getUpdates(this.offset);
      this.consecutiveFailures = 0;
      this.lastPollError = "";
      for (const update of updates) {
        this.offset = update.update_id + 1;
        if (update.message) {
          await this.handleMessage(update.message);
        }
      }
      this.scheduleNextPoll(500);
      return;
    } catch (err) {
      this.consecutiveFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastPollError || this.consecutiveFailures === 1) {
        console.warn(`[feather.telegram] polling failed: ${message}`);
        this.lastPollError = message;
      }
    }

    this.scheduleNextPoll(Math.min(30000, 1000 * 2 ** (this.consecutiveFailures - 1)));
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => { void this.poll(); }, delayMs);
  }

  private async handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    await this.receiveTextMessage({
      chatId: msg.chat.id,
      userId: msg.from?.id,
      text: (msg.text ?? "").trim(),
    });
  }

  async receiveTextMessage(input: { chatId: number; userId?: number; text: string }): Promise<void> {
    const { chatId, userId } = input;
    const text = input.text.trim();

    if (!this.isAllowedUser(userId)) {
      await this.transport.sendMessage(chatId, "❌ Unauthorized. This Feather instance does not allow your user ID.");
      return;
    }

    try {
      if (text.startsWith("/")) {
        const [cmdRaw, ...args] = text.split(" ");
        const cmd = cmdRaw ?? "";
        const panic = getPanicState();

        if (panic.active && !this.isAllowedDuringPanic(cmd, args)) {
          await this.transport.sendMessage(chatId, "🚨 Panic mode is active. Only safe read-only commands are allowed.");
          return;
        }

        switch (cmd) {
          case "/status":   await this.cmdStatus(chatId); break;
          case "/projects": await this.cmdProjects(chatId); break;
          case "/task":     await this.cmdTask(chatId, args); break;
          case "/approvals":await this.cmdApprovals(chatId); break;
          case "/approve":  await this.cmdApprove(chatId, args[0]); break;
          case "/reject":   await this.cmdReject(chatId, args[0]); break;
          case "/recap":    await this.cmdRecap(chatId, args[0]); break;
          case "/heartbeat":await this.cmdHeartbeat(chatId, args); break;
          case "/budget":   await this.cmdBudget(chatId); break;
          case "/help":     await this.cmdHelp(chatId); break;
          case "/actions":  await this.cmdActions(chatId); break;
          case "/menu":     await this.cmdActions(chatId); break;
          case "/examples": await this.cmdExamples(chatId); break;
          case "/panic":    await this.cmdPanic(chatId); break;
          case "/resume":   await this.cmdResume(chatId, args); break;
          case "/cancel":   await this.cmdCancelTask(chatId, args[0]); break;
          case "/memories": await this.cmdMemories(chatId, args); break;
          case "/save-memory": await this.cmdSaveMemory(chatId, args); break;
          case "/forget-memory": await this.cmdForgetMemory(chatId, args[0]); break;
          case "/skills": await this.cmdSkills(chatId, args[0]); break;
          case "/use-skill": await this.cmdUseSkill(chatId, args); break;
          default:
            await this.transport.sendMessage(chatId, "Unknown command. Use /help.");
        }
        return;
      }

      if (this.config.freeform?.enabled === false) {
        await this.transport.sendMessage(chatId, "Plain Telegram messages are disabled in this Feather config. Use /help for commands.");
        return;
      }

      await this.handleFreeformMessage(chatId, userId ?? 0, text);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.transport.sendMessage(chatId, `❌ Error: ${errorMessage}`);
    }
  }

  private async handleFreeformMessage(chatId: number, userId: number, text: string): Promise<void> {
    const normalized = normalizeTelegramText(text);
    const pendingConfirmation = this.getPendingConfirmation(chatId, userId);

    if (normalized === "approve task") {
      if (!pendingConfirmation) {
        await this.transport.sendMessage(chatId, "There is no pending task confirmation. Send a plain task request first.");
        return;
      }
      await this.approvePendingTask(chatId, pendingConfirmation);
      return;
    }

    if (normalized === "cancel" && pendingConfirmation) {
      this.pendingConfirmations.delete(this.pendingConfirmationKey(chatId, userId));
      await this.transport.sendMessage(chatId, "Cancelled the pending task proposal.");
      return;
    }

    if (normalized === "resume confirm") {
      await this.cmdResume(chatId, ["confirm"]);
      return;
    }

    const projects = await this.services.projects.listProjects();
    const pendingApprovals = await this.services.approvals.getPendingApprovals();
    const intent = classifyTelegramFreeformIntent(text, { projects, pendingApprovals });
    const panic = getPanicState();
    if (panic.active && !this.isFreeformAllowedDuringPanic(intent)) {
      await this.transport.sendMessage(chatId, "🚨 Panic mode is active. Only safe read-only Telegram actions are allowed.");
      return;
    }

    switch (intent.type) {
      case "panic":
        await this.cmdPanic(chatId);
        return;
      case "cancel_task":
        if (!intent.taskId) {
          await this.transport.sendMessage(chatId, "Tell me which task to cancel, for example: cancel task_123");
          return;
        }
        await this.cmdCancelTask(chatId, intent.taskId);
        return;
      case "approval_response":
        await this.handleFreeformApproval(chatId, intent, pendingApprovals);
        return;
      case "read_only_question":
        await this.answerReadOnlyQuestion(chatId, intent, projects);
        return;
      case "create_task":
        await this.proposeOrCreateTask(chatId, userId, intent, projects);
        return;
      case "unknown":
      default:
        await this.transport.sendMessage(
          chatId,
          "I can help with status, approvals, projects, panic/cancel, or propose a task. Try 'status', 'show projects', or 'update the README'.",
        );
    }
  }

  private async cmdStatus(chatId: number): Promise<void> {
    const panic = getPanicState();
    const projects = await this.services.projects.listProjects();
    const pending = await this.services.approvals.getPendingApprovals();

    const status = panic.active ? "🚨 PANIC MODE" : "✅ Running";
    const lines = [
      `*Feather Status*`,
      `Status: ${status}`,
      `Projects: ${projects.length}`,
      `Pending approvals: ${pending.length}`,
    ];
    if (panic.active && panic.activatedAt) {
      lines.push(`Panic since: ${panic.activatedAt}`);
    }
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdProjects(chatId: number): Promise<void> {
    const projects = await this.services.projects.listProjects();
    if (projects.length === 0) {
      await this.transport.sendMessage(chatId, "No projects registered.");
      return;
    }
    const lines = ["*Projects*", ...projects.map((p) => `• ${p.name} — \`${p.rootPath}\``)];
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdTask(chatId: number, args: string[]): Promise<void> {
    if (args.length < 2) {
      await this.transport.sendMessage(chatId, "Usage: /task <project-name> <prompt>");
      return;
    }
    const [projectNameRaw, ...promptParts] = args;
    const projectName = projectNameRaw ?? "";
    const prompt = promptParts.join(" ");

    const projects = await this.services.projects.listProjects();
    const project = projects.find((p) => p.name === projectName || p.id === projectName);
    if (!project) {
      await this.transport.sendMessage(chatId, `Project not found: ${projectName}`);
      return;
    }

    const providerId = await resolveTaskProviderId({
      projectId: project.id,
      globalDefaultProviderId: this.config.globalDefaultProviderId ?? this.config.defaultProviderId,
      allowSingleProviderAutoRoute: this.config.allowSingleProviderAutoRoute === true,
      projects: this.services.projects,
      providers: this.services.providers,
    });

    const task = await this.services.tasks.createTask({
      projectId: project.id,
      title: prompt.slice(0, 60),
      prompt,
      providerId,
      createdBy: "telegram",
    });

    void this.services.tasks.runTask(task.id);
    await this.transport.sendMessage(chatId, `✅ Task created: \`${task.id}\`\nPrompt: ${prompt.slice(0, 100)}`);
  }

  private async cmdApprovals(chatId: number): Promise<void> {
    const pending = await this.services.approvals.getPendingApprovals();
    if (pending.length === 0) {
      await this.transport.sendMessage(chatId, "No pending approvals.");
      return;
    }

    const lines = ["*Pending Approvals*", ""];
    for (const a of pending) {
      lines.push(`*${a.title}*`);
      if (a.projectId) lines.push(`Project: ${a.projectId}`);
      lines.push(`Action: ${a.actionType}`);
      lines.push(`Risk: ${a.risk}`);
      lines.push(`Reason: ${a.reason}`);
      lines.push(`Approve: /approve ${a.id}`);
      lines.push(`Reject: /reject ${a.id}`);
      lines.push("");
    }
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdApprove(chatId: number, id: string | undefined): Promise<void> {
    if (!id) {
      await this.transport.sendMessage(chatId, "Usage: /approve <approval-id>");
      return;
    }
    await this.services.approvals.resolveApproval(id, "approved", "once");
    await this.transport.sendMessage(chatId, `✅ Approved: \`${id}\``);
  }

  private async cmdReject(chatId: number, id: string | undefined): Promise<void> {
    if (!id) {
      await this.transport.sendMessage(chatId, "Usage: /reject <approval-id>");
      return;
    }
    await this.services.approvals.resolveApproval(id, "rejected");
    await this.transport.sendMessage(chatId, `❌ Rejected: \`${id}\``);
  }

  private async cmdRecap(chatId: number, projectName: string | undefined): Promise<void> {
    if (!projectName) {
      await this.transport.sendMessage(chatId, "Usage: /recap <project-name>");
      return;
    }
    const projects = await this.services.projects.listProjects();
    const project = projects.find((p) => p.name === projectName || p.id === projectName);
    if (!project) {
      await this.transport.sendMessage(chatId, `Project not found: ${projectName}`);
      return;
    }
    const recap = await this.services.heartbeat.generateDailyRecap(project.id);
    await this.transport.sendMessage(chatId, recap);
  }

  private async cmdHeartbeat(chatId: number, args: string[]): Promise<void> {
    // /heartbeat <project> on|off — placeholder; heartbeat is global in v0.1
    const [, action] = args;
    if (action === "on") {
      this.services.heartbeat.start();
      await this.transport.sendMessage(chatId, "✅ Heartbeat started.");
    } else if (action === "off") {
      this.services.heartbeat.stop();
      await this.transport.sendMessage(chatId, "⏹ Heartbeat stopped.");
    } else {
      await this.transport.sendMessage(chatId, "Usage: /heartbeat <project> on|off");
    }
  }

  private async cmdBudget(chatId: number): Promise<void> {
    const spend = await this.services.budgets.getDailySpendCents();
    const dollars = (spend / 100).toFixed(2);
    await this.transport.sendMessage(chatId, `💰 Daily spend: $${dollars}`);
  }

  private async cmdHelp(chatId: number): Promise<void> {
    const lines = [
      "*Feather Commands*",
      "",
      "/status — Daemon status",
      "/projects — List projects",
      "/task <project> <prompt> — Create a task",
      "/approvals — List pending approvals",
      "/approve <id> — Approve an action",
      "/reject <id> — Reject an action",
      "/recap <project> — Daily recap",
      "/heartbeat <project> on|off — Toggle heartbeat",
      "/budget — Daily spend",
      "/memories — List explicit memories",
      "/save-memory global <text> — Save global memory",
      "/save-memory project <project> <text> — Save project memory",
      "/forget-memory <id> — Delete a memory",
      "/skills [project] — List local skills",
      "/use-skill <project> <skill> <task prompt> — Create a task with a skill",
      "/actions — Grouped operator view",
      "/menu — Alias for /actions",
      "/examples — Copyable slash and freeform examples",
      "/help — This message",
      "",
      "*Safety commands*",
      "/panic — Activate panic mode (cancels all tasks)",
      "/resume confirm — Deactivate panic mode",
      "/cancel <taskId> — Cancel a specific task",
    ];
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdActions(chatId: number): Promise<void> {
    const lines = [
      "*Feather Actions*",
      "",
      "*Read-only*",
      "- status",
      "- projects",
      "- approvals",
      "- budget",
      "- recap <project>",
      "- memories",
      "- skills",
      "",
      "*Work*",
      "- task <project> <prompt>",
      "- use-skill <project> <skill> <prompt>",
      "",
      "*Control*",
      "- panic",
      "- resume confirm",
      "- cancel <taskId>",
      "",
      "*Memory*",
      "- save-memory global <text>",
      "- save-memory project <project> <text>",
      "- forget-memory <id>",
      "",
      "*Guard*",
      "- check /health in dashboard or API",
      "- run feather-supervisor status locally",
    ];
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdExamples(chatId: number): Promise<void> {
    const lines = [
      "*Feather Examples*",
      "",
      "*Read-only*",
      "status",
      "what's going on with Feather?",
      "show projects",
      "any pending approvals?",
      "summarise today for Feather",
      "",
      "*Create work safely*",
      "fix the README alpha wording",
      "/task Feather fix the README alpha wording",
      "",
      "*Approvals*",
      "approve <id>",
      "reject <id>",
      "approve task",
      "",
      "*Panic*",
      "panic",
      "/panic",
      "/resume confirm",
      "",
      "*Memory*",
      "save-memory global Keep summaries short and direct",
      "/save-memory project Feather constraint Always run tests before marking done",
      "",
      "*Skills*",
      "skills",
      "/use-skill Feather safe-ui-pass clean the dashboard cards",
    ];
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdPanic(chatId: number): Promise<void> {
    await activatePanic("Telegram /panic command");
    await this.services.tasks.cancelAllActive("panic");
    this.services.heartbeat.stop();
    await this.transport.sendMessage(chatId, "🚨 Panic mode activated. All active tasks have been cancelled. Send /resume confirm to resume.");
  }

  private async cmdResume(chatId: number, args: string[]): Promise<void> {
    if (args[0] !== "confirm") {
      await this.transport.sendMessage(chatId, "⚠️ To deactivate panic mode, send exactly: /resume confirm");
      return;
    }
    await deactivatePanic();
    this.services.heartbeat.start();
    await this.transport.sendMessage(chatId, "✅ Panic mode deactivated. Daemon is running normally.");
  }

  private async cmdCancelTask(chatId: number, taskId: string | undefined): Promise<void> {
    if (!taskId) {
      await this.transport.sendMessage(chatId, "Usage: /cancel <taskId>");
      return;
    }
    await this.services.tasks.cancelTask(taskId, "cancelled");
    await this.transport.sendMessage(chatId, `🛑 Task \`${taskId}\` cancelled.`);
  }

  private async cmdMemories(chatId: number, args: string[]): Promise<void> {
    const scopeArg = args[0];
    const projectArg = args[1];
    const memories = await this.services.memories.list({
      ...(scopeArg === "global" || scopeArg === "project" ? { scope: scopeArg } : {}),
      ...(projectArg ? { projectId: projectArg } : {}),
    });
    if (memories.length === 0) {
      await this.transport.sendMessage(chatId, "No explicit memories saved.");
      return;
    }
    const lines = ["*Explicit Memories*", ""];
    for (const memory of memories.slice(0, 20)) {
      lines.push(`\`${memory.id}\` [${memory.scope}/${memory.kind}] ${memory.content}`);
    }
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdSaveMemory(chatId: number, args: string[]): Promise<void> {
    const scopeArg = args[0];
    if (scopeArg !== "global" && scopeArg !== "project") {
      await this.transport.sendMessage(chatId, "Usage: /save-memory global <text> OR /save-memory project <project> <text>");
      return;
    }

    const memoryKinds = new Set(["preference", "fact", "decision", "constraint", "workflow"]);
    let kind: "preference" | "fact" | "decision" | "constraint" | "workflow" = "fact";
    let projectId: string | undefined;
    let contentStartIndex = 1;

    if (scopeArg === "project") {
      const projectArg = args[1];
      if (!projectArg) {
        await this.transport.sendMessage(chatId, "Usage: /save-memory project <project> <text>");
        return;
      }
      const projects = await this.services.projects.listProjects();
      const project = projects.find((entry) => entry.id === projectArg || entry.name === projectArg);
      if (!project) {
        await this.transport.sendMessage(chatId, `Project not found: ${projectArg}`);
        return;
      }
      projectId = project.id;
      contentStartIndex = 2;
    }

    const kindCandidate = args[contentStartIndex];
    if (kindCandidate && memoryKinds.has(kindCandidate)) {
      kind = kindCandidate as typeof kind;
      contentStartIndex += 1;
    }

    const content = args.slice(contentStartIndex).join(" ").trim();
    if (!content) {
      await this.transport.sendMessage(chatId, "Memory content cannot be empty.");
      return;
    }

    const memory = await this.services.memories.create({
      scope: scopeArg,
      ...(projectId ? { projectId } : {}),
      kind,
      content,
    });
    await this.transport.sendMessage(chatId, `Saved memory \`${memory.id}\` as ${memory.scope}/${memory.kind}.`);
  }

  private async cmdForgetMemory(chatId: number, id: string | undefined): Promise<void> {
    if (!id) {
      await this.transport.sendMessage(chatId, "Usage: /forget-memory <id>");
      return;
    }
    await this.services.memories.delete(id);
    await this.transport.sendMessage(chatId, `Deleted memory \`${id}\`.`);
  }

  private async cmdSkills(chatId: number, projectArg: string | undefined): Promise<void> {
    let projectId: string | undefined;
    if (projectArg) {
      const projects = await this.services.projects.listProjects();
      const project = projects.find((entry) => entry.id === projectArg || entry.name === projectArg);
      if (!project) {
        await this.transport.sendMessage(chatId, `Project not found: ${projectArg}`);
        return;
      }
      projectId = project.id;
    }

    const skills = await this.services.skills.list(projectId ? { scope: "project", projectId } : {});
    if (skills.length === 0) {
      await this.transport.sendMessage(chatId, "No skills found.");
      return;
    }
    const lines = ["*Skills*", ""];
    for (const skill of skills) {
      lines.push(`\`${skill.id}\` ${skill.name} [${skill.scope}]`);
    }
    await this.transport.sendMessage(chatId, lines.join("\n"));
  }

  private async cmdUseSkill(chatId: number, args: string[]): Promise<void> {
    if (args.length < 3) {
      await this.transport.sendMessage(chatId, "Usage: /use-skill <project> <skill> <task prompt>");
      return;
    }

    const [projectArg, skillArg, ...promptParts] = args;
    const prompt = promptParts.join(" ").trim();
    const projects = await this.services.projects.listProjects();
    const project = projects.find((entry) => entry.id === projectArg || entry.name === projectArg);
    if (!project) {
      await this.transport.sendMessage(chatId, `Project not found: ${projectArg}`);
      return;
    }

    const skills = await this.services.skills.list({ projectId: project.id });
    const skill = skills.find((entry) => entry.id === skillArg || entry.name === skillArg || entry.id.endsWith(`:${skillArg}`));
    if (!skill) {
      await this.transport.sendMessage(chatId, `Skill not found: ${skillArg}`);
      return;
    }

    const providerId = await resolveTaskProviderId({
      projectId: project.id,
      globalDefaultProviderId: this.config.globalDefaultProviderId ?? this.config.defaultProviderId,
      allowSingleProviderAutoRoute: this.config.allowSingleProviderAutoRoute === true,
      projects: this.services.projects,
      providers: this.services.providers,
    });
    const task = await this.services.tasks.createTask({
      projectId: project.id,
      skillId: skill.id,
      title: prompt.slice(0, 60),
      prompt,
      providerId,
      createdBy: "telegram",
    });
    void this.services.tasks.runTask(task.id);
    await this.transport.sendMessage(chatId, `✅ Task created with skill \`${skill.name}\`: \`${task.id}\``);
  }

  private async handleFreeformApproval(
    chatId: number,
    intent: Extract<TelegramFreeformIntent, { type: "approval_response" }>,
    pendingApprovals: Approval[],
  ): Promise<void> {
    if (!intent.approvalId) {
      if (pendingApprovals.length === 0) {
        await this.transport.sendMessage(chatId, "There are no pending approvals.");
        return;
      }
      if (pendingApprovals.length > 1) {
        await this.transport.sendMessage(chatId, "Multiple approvals are pending. Reply with 'approve <id>' or 'reject <id>'.");
        return;
      }
    }

    const approvalId = intent.approvalId ?? pendingApprovals[0]!.id;
    if (intent.decision === "approve") {
      await this.cmdApprove(chatId, approvalId);
      return;
    }
    await this.cmdReject(chatId, approvalId);
  }

  private async answerReadOnlyQuestion(
    chatId: number,
    intent: Extract<TelegramFreeformIntent, { type: "read_only_question" }>,
    projects: Project[],
  ): Promise<void> {
    const normalized = normalizeTelegramText(intent.question);
    if (normalized.includes("project")) {
      await this.cmdProjects(chatId);
      return;
    }
    if (normalized.includes("approval")) {
      await this.cmdApprovals(chatId);
      return;
    }
    if (normalized.includes("budget")) {
      await this.cmdBudget(chatId);
      return;
    }
    if (normalized.includes("recap") || normalized.includes("summarise today") || normalized.includes("summarize today")) {
      const project = this.resolveReadOnlyProject(intent.projectId, projects);
      if (!project && projects.length > 1) {
        await this.transport.sendMessage(chatId, "Tell me which project you want a recap for.");
        return;
      }
      if (project) {
        await this.cmdRecap(chatId, project.id);
        return;
      }
    }

    if (normalized.includes("what should i work on")) {
      await this.transport.sendMessage(chatId, await this.buildNextWorkSummary(intent.projectId));
      return;
    }

    await this.transport.sendMessage(chatId, await this.buildStatusSummary(intent.projectId));
  }

  private async proposeOrCreateTask(
    chatId: number,
    userId: number,
    intent: Extract<TelegramFreeformIntent, { type: "create_task" }>,
    projects: Project[],
  ): Promise<void> {
    if (projects.length === 0) {
      await this.transport.sendMessage(chatId, "No projects are registered yet, so I cannot turn that into a task.");
      return;
    }

    const project = this.resolveCreateTaskProject(intent.projectId, projects);
    if (!project) {
      await this.transport.sendMessage(chatId, "I need a project for that task. Mention the project name or register only one project.");
      return;
    }

    const providerId = await resolveTaskProviderId({
      projectId: project.id,
      globalDefaultProviderId: this.config.globalDefaultProviderId ?? this.config.defaultProviderId,
      allowSingleProviderAutoRoute: this.config.allowSingleProviderAutoRoute === true,
      projects: this.services.projects,
      providers: this.services.providers,
    });

    const createTaskNeedsConfirmation = this.config.freeform?.confirmations?.createTask !== false;
    if (!createTaskNeedsConfirmation) {
      const task = await this.createTelegramTask(project.id, providerId, intent.prompt);
      await this.transport.sendMessage(chatId, `✅ Task created: \`${task.id}\`\nPrompt: ${intent.prompt.slice(0, 100)}`);
      return;
    }

    const now = Date.now();
    const confirmation: PendingTelegramConfirmation = {
      id: nanoid(),
      chatId,
      userId,
      type: "create_task",
      projectId: project.id,
      providerId,
      prompt: intent.prompt,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CREATE_TASK_CONFIRMATION_TTL_MS).toISOString(),
    };
    this.pendingConfirmations.set(this.pendingConfirmationKey(chatId, userId), confirmation);

    await this.transport.sendMessage(
      chatId,
      [
        "I can create this task.",
        "",
        `Project: ${project.name}`,
        `Provider: ${providerId}`,
        `Risk: ${intent.risk === "review" ? "may write files / run shell" : "safe"}`,
        `Prompt: ${intent.prompt}`,
        "",
        "Reply \"approve task\" to start or \"cancel\".",
      ].join("\n"),
    );
  }

  private async approvePendingTask(chatId: number, confirmation: PendingTelegramConfirmation): Promise<void> {
    const panic = getPanicState();
    if (panic.active) {
      await this.transport.sendMessage(chatId, "🚨 Panic mode is active. Task proposals cannot be approved right now.");
      return;
    }

    const task = await this.createTelegramTask(confirmation.projectId, confirmation.providerId, confirmation.prompt);
    this.pendingConfirmations.delete(this.pendingConfirmationKey(confirmation.chatId, confirmation.userId));
    await this.transport.sendMessage(chatId, `✅ Task created: \`${task.id}\`\nPrompt: ${confirmation.prompt.slice(0, 100)}`);
  }

  private async createTelegramTask(projectId: string | undefined, providerId: string | undefined, prompt: string): Promise<Task> {
    if (!providerId) {
      throw new Error("No provider selected for Telegram task.");
    }
    const task = await this.services.tasks.createTask({
      projectId,
      title: prompt.slice(0, 60),
      prompt,
      providerId,
      createdBy: "telegram",
    });
    void this.services.tasks.runTask(task.id);
    return task;
  }

  private resolveReadOnlyProject(projectId: string | undefined, projects: Project[]): Project | undefined {
    if (projectId) {
      return projects.find((project) => project.id === projectId);
    }
    if (projects.length === 1) {
      return projects[0];
    }
    return undefined;
  }

  private resolveCreateTaskProject(projectId: string | undefined, projects: Project[]): Project | undefined {
    if (projectId) {
      return projects.find((project) => project.id === projectId);
    }
    if (projects.length === 1) {
      return projects[0];
    }
    return undefined;
  }

  private async buildStatusSummary(projectId?: string): Promise<string> {
    const panic = getPanicState();
    const [projects, approvals, tasks, observations, spendCents] = await Promise.all([
      this.services.projects.listProjects(),
      this.services.approvals.getPendingApprovals(projectId),
      this.services.tasks.listTasks(projectId),
      this.services.heartbeat.getObservations(projectId),
      this.services.budgets.getDailySpendCents(projectId),
    ]);
    const activeTasks = tasks.filter((task) => task.status === "queued" || task.status === "running");
    const project = projectId ? projects.find((item) => item.id === projectId) : undefined;
    const lines = [
      `Feather is ${panic.active ? "in panic mode" : "running normally"}.`,
      project ? `Project: ${project.name}` : `Projects: ${projects.length}`,
      `Active tasks: ${activeTasks.length}`,
      `Pending approvals: ${approvals.length}`,
      `Recent observations: ${observations.slice(-3).length}`,
      `Daily spend: $${(spendCents / 100).toFixed(2)}`,
    ];
    const latestObservation = observations.slice(-1)[0];
    if (latestObservation) {
      lines.push(`Latest observation: ${latestObservation.title}`);
    }
    return lines.join("\n");
  }

  private async buildNextWorkSummary(projectId?: string): Promise<string> {
    const [approvals, observations, tasks] = await Promise.all([
      this.services.approvals.getPendingApprovals(projectId),
      this.services.heartbeat.getObservations(projectId),
      this.services.tasks.listTasks(projectId),
    ]);
    if (approvals.length > 0) {
      const approval = approvals[0]!;
      return `The clearest blocker is approval ${approval.id}: ${approval.title}. Reply 'approve ${approval.id}' or 'reject ${approval.id}'.`;
    }
    const suggestedObservation = [...observations].reverse().find((observation) => observation.suggestedActions.length > 0);
    if (suggestedObservation?.suggestedActions[0]) {
      return `Suggested next step: ${suggestedObservation.suggestedActions[0].label}.`;
    }
    const activeTask = tasks.find((task) => task.status === "running" || task.status === "queued");
    if (activeTask) {
      return `You already have an active task: ${activeTask.title} (${activeTask.id}).`;
    }
    return "Nothing urgent is pending. Ask me for status, approvals, or propose a new task.";
  }

  private pendingConfirmationKey(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  private getPendingConfirmation(chatId: number, userId: number): PendingTelegramConfirmation | undefined {
    const key = this.pendingConfirmationKey(chatId, userId);
    const pending = this.pendingConfirmations.get(key);
    if (!pending) {
      return undefined;
    }
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.pendingConfirmations.delete(key);
      return undefined;
    }
    return pending;
  }

  /**
   * Send an approval notification to all allowed users.
   */
  async notifyApproval(approvalId: string, title: string, project: string, action: string, risk: string, reason: string): Promise<void> {
    const text = [
      "*Feather approval needed*",
      "",
      `Title: ${title}`,
      `Project: ${project}`,
      `Action: ${action}`,
      `Risk: ${risk}`,
      `Reason: ${reason}`,
      `Approval ID: ${approvalId}`,
      "Diff available in dashboard.",
      "",
      `Approve once: /approve ${approvalId}`,
      `Reject: /reject ${approvalId}`,
    ].join("\n");

    for (const userId of this.config.allowedUserIds) {
      await this.transport.sendMessage(userId, text);
    }
  }

  private isFreeformAllowedDuringPanic(intent: TelegramFreeformIntent): boolean {
    switch (intent.type) {
      case "read_only_question":
      case "cancel_task":
      case "panic":
        return true;
      case "approval_response":
        return intent.decision === "reject";
      default:
        return false;
    }
  }

  private isAllowedDuringPanic(cmd: string, args: string[]): boolean {
    switch (cmd) {
      case "/status":
      case "/projects":
      case "/approvals":
      case "/budget":
      case "/memories":
      case "/skills":
      case "/help":
      case "/actions":
      case "/menu":
      case "/examples":
      case "/recap":
      case "/reject":
      case "/panic":
      case "/cancel":
        return true;
      case "/resume":
        return args[0] === "confirm";
      case "/heartbeat":
        return args[1] === "off";
      default:
        return false;
    }
  }
}
