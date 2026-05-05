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
  chat?: {
    enabled?: boolean;
    providerId?: string;
    maxContextMessages?: number;
    maxOutputTokens?: number;
  };
  /** @deprecated Use globalDefaultProviderId. */
  defaultProviderId?: string;
};

export type TelegramFreeformIntent =
  | {
      type: "read_only_question";
      projectId?: string;
      question: string;
      topic: TelegramReadOnlyTopic;
    }
  | { type: "create_task"; projectId?: string; prompt: string; risk: "safe" | "review" }
  | { type: "approval_response"; decision: "approve" | "reject"; approvalId?: string }
  | { type: "panic" }
  | { type: "cancel_task"; taskId?: string }
  | { type: "clear_chat" }
  | { type: "continue_task_from_conversation" }
  | { type: "conversation"; message: string };

type TelegramReadOnlyTopic =
  | "status"
  | "projects"
  | "approvals"
  | "budget"
  | "running"
  | "panic_state"
  | "recap"
  | "next_work";

export type PendingTelegramConfirmation = {
  id: string;
  chatId: number;
  userId: number;
  type: "create_task";
  title: string;
  projectId?: string;
  providerId?: string;
  prompt: string;
  risk: "safe" | "review";
  source: "direct_request" | "conversation";
  createdAt: string;
  expiresAt: string;
};

type TelegramSessionMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type PendingProjectSelection = {
  title: string;
  prompt: string;
  risk: "safe" | "review";
  source: "direct_request" | "conversation";
};

type TelegramConversationSession = {
  messages: TelegramSessionMessage[];
  updatedAt: number;
  pendingProjectSelection?: PendingProjectSelection;
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

const FREEFORM_ACTION_VERBS = ["fix", "change", "update", "edit", "build", "install", "commit", "push", "write", "create", "run", "add", "document", "make"];
const CONTINUE_TASK_PHRASES = ["do it", "make that change", "create the task", "go ahead", "ship it", "turn that into a task"];
const CHAT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CREATE_TASK_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export function buildTelegramSendPayload(chatId: number, text: string): { chat_id: number; text: string } {
  return {
    chat_id: chatId,
    text,
  };
}

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

  if (normalized === "clear chat") {
    return { type: "clear_chat" };
  }

  if (CONTINUE_TASK_PHRASES.includes(normalized)) {
    return { type: "continue_task_from_conversation" };
  }

  const readOnlyTopic = resolveReadOnlyTopic(normalized);
  if (readOnlyTopic) {
    const project = findProjectMention(options.projects, normalized);
    return { type: "read_only_question", question: message.trim(), projectId: project?.id, topic: readOnlyTopic };
  }

  if (looksLikeActionRequest(normalized)) {
    const project = findProjectMention(options.projects, normalized);
    return { type: "create_task", prompt: message.trim(), projectId: project?.id, risk: "review" };
  }

  return { type: "conversation", message: message.trim() };
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

function resolveReadOnlyTopic(normalized: string): TelegramReadOnlyTopic | undefined {
  if (
    normalized === "status"
    || normalized.includes("what's going on")
    || normalized.includes("whats going on")
    || normalized.includes("status summary")
    || normalized.startsWith("check ")
  ) {
    return "status";
  }

  if (
    normalized.includes("show projects")
    || normalized.includes("list projects")
    || normalized.includes("registered projects")
    || normalized.includes("what projects are registered")
    || normalized === "projects"
  ) {
    return "projects";
  }

  if (
    normalized.includes("pending approvals")
    || normalized.includes("show approvals")
    || normalized.includes("any approvals")
    || normalized === "approvals"
  ) {
    return "approvals";
  }

  if (normalized === "budget" || normalized.includes("show budget") || normalized.includes("daily spend")) {
    return "budget";
  }

  if (normalized.includes("what is running") || normalized.includes("what's running") || normalized.includes("whats running") || normalized.includes("anything running")) {
    return "running";
  }

  if (normalized.includes("panic state") || normalized.includes("panic active") || normalized.includes("is panic on")) {
    return "panic_state";
  }

  if (normalized.includes("summarise today") || normalized.includes("summarize today") || normalized.includes("recap")) {
    return "recap";
  }

  if (normalized.includes("what should i work on") || normalized.includes("what should we build next")) {
    return "next_work";
  }

  return undefined;
}

function looksLikeActionRequest(normalized: string): boolean {
  if (/^(how|what|why|should|can you help|could you help)/.test(normalized)) {
    return false;
  }

  const prefixes = ["can you ", "could you ", "please "];
  let candidate = normalized;
  for (const prefix of prefixes) {
    if (candidate.startsWith(prefix)) {
      candidate = candidate.slice(prefix.length).trim();
      break;
    }
  }

  return FREEFORM_ACTION_VERBS.some((verb) => candidate === verb || candidate.startsWith(`${verb} `));
}

function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
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
  const result = await telegramRequest(token, "sendMessage", buildTelegramSendPayload(chatId, text)) as {
    ok?: boolean;
    description?: string;
    error_code?: number;
  };
  if (!result.ok) {
    throw new Error(result.description ?? `Telegram sendMessage failed (${result.error_code ?? "unknown"})`);
  }
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
  private sessions = new Map<string, TelegramConversationSession>();

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
    const resolvedUserId = userId ?? 0;
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
          case "/clear-chat": await this.cmdClearChat(chatId, resolvedUserId); break;
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

      await this.handleFreeformMessage(chatId, resolvedUserId, text);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      try {
        await this.transport.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      } catch (sendErr) {
        const sendMessageError = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.warn(`[feather.telegram] failed to surface error to chat ${chatId}: ${sendMessageError}`);
        throw sendErr;
      }
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

    if (normalized.startsWith("edit:")) {
      await this.editPendingProposal(chatId, userId, text.slice(5).trim());
      return;
    }

    if (normalized === "cancel") {
      const hadPendingProposal = Boolean(pendingConfirmation);
      const hadProjectSelection = Boolean(this.getSession(chatId, userId)?.pendingProjectSelection);
      this.clearPendingProposalState(chatId, userId);
      if (hadPendingProposal || hadProjectSelection) {
        await this.sendConversationReply(chatId, userId, "Cancelled the pending task proposal.");
      } else {
        await this.transport.sendMessage(chatId, "Nothing is pending. Use /cancel <taskId> to stop a running task.");
      }
      return;
    }

    if (normalized === "resume confirm") {
      await this.cmdResume(chatId, ["confirm"]);
      return;
    }

    const projects = await this.services.projects.listProjects();
    if (await this.handlePendingProjectSelection(chatId, userId, text, projects)) {
      return;
    }

    const pendingApprovals = await this.services.approvals.getPendingApprovals();
    const intent = classifyTelegramFreeformIntent(text, { projects, pendingApprovals });
    const panic = getPanicState();

    if (panic.active && (intent.type === "create_task" || intent.type === "continue_task_from_conversation")) {
      this.appendSessionMessage(chatId, userId, "user", text);
      await this.sendConversationReply(chatId, userId, "I can discuss the plan, but I cannot create or approve work until panic is resumed.");
      return;
    }

    if (panic.active && intent.type === "approval_response" && intent.decision !== "reject") {
      await this.transport.sendMessage(chatId, "I can discuss the plan, but I cannot create or approve work until panic is resumed.");
      return;
    }

    if (panic.active && !this.isFreeformAllowedDuringPanic(intent)) {
      await this.transport.sendMessage(chatId, "🚨 Panic mode is active. Only safe read-only Telegram actions are allowed.");
      return;
    }

    switch (intent.type) {
      case "panic":
        await this.cmdPanic(chatId);
        return;
      case "clear_chat":
        await this.cmdClearChat(chatId, userId);
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
        this.appendSessionMessage(chatId, userId, "user", text);
        await this.proposeTaskRequest(chatId, userId, {
          title: this.buildTaskTitle(intent.prompt),
          prompt: intent.prompt,
          projectId: intent.projectId,
          risk: intent.risk,
          source: "direct_request",
        }, projects);
        return;
      case "continue_task_from_conversation":
        this.appendSessionMessage(chatId, userId, "user", text);
        await this.proposeTaskFromConversation(chatId, userId, projects);
        return;
      case "conversation":
        this.appendSessionMessage(chatId, userId, "user", intent.message);
        await this.replyToConversation(chatId, userId, intent.message, projects, pendingApprovals);
        return;
      default:
        await this.transport.sendMessage(chatId, "I could not understand that. Ask for status, discuss a plan, or ask me to propose a task.");
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
      "/clear-chat — Clear Telegram conversation state",
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
      "Plain messages can ask for local state, discuss plans, and create task proposals that still need approval.",
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
      "- clear-chat",
      "- memories",
      "- skills",
      "",
      "*Work*",
      "- task <project> <prompt>",
      "- use-skill <project> <skill> <prompt>",
      "- plain conversation -> task proposal -> approve task",
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
      "what can you do?",
      "help me plan a docs polish pass",
      "",
      "*Create work safely*",
      "fix the README alpha wording",
      "create a small note in docs saying Telegram alpha test worked",
      "/task Feather fix the README alpha wording",
      "do it",
      "",
      "*Approvals*",
      "approve <id>",
      "reject <id>",
      "approve task",
      "edit: make it docs only",
      "",
      "*Panic*",
      "panic",
      "/panic",
      "/resume confirm",
      "clear chat",
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

  private async cmdClearChat(chatId: number, userId: number): Promise<void> {
    this.clearConversationState(chatId, userId);
    await this.transport.sendMessage(chatId, "Cleared the Telegram chat session and any pending task proposal.");
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
    switch (intent.topic) {
      case "projects":
        await this.cmdProjects(chatId);
        return;
      case "approvals":
        await this.cmdApprovals(chatId);
        return;
      case "budget":
        await this.cmdBudget(chatId);
        return;
      case "running":
        await this.transport.sendMessage(chatId, await this.buildRunningSummary(intent.projectId));
        return;
      case "panic_state":
        await this.transport.sendMessage(chatId, this.buildPanicStatusSummary());
        return;
      case "recap": {
        const project = this.resolveReadOnlyProject(intent.projectId, projects);
        if (!project && projects.length > 1) {
          await this.transport.sendMessage(chatId, "Tell me which project you want a recap for.");
          return;
        }
        if (project) {
          await this.cmdRecap(chatId, project.id);
          return;
        }
        await this.transport.sendMessage(chatId, await this.buildStatusSummary(intent.projectId));
        return;
      }
      case "next_work":
        await this.transport.sendMessage(chatId, await this.buildNextWorkSummary(intent.projectId));
        return;
      case "status":
      default:
        await this.transport.sendMessage(chatId, await this.buildStatusSummary(intent.projectId));
    }
  }

  private async proposeTaskRequest(
    chatId: number,
    userId: number,
    proposal: {
      title: string;
      prompt: string;
      projectId?: string;
      risk: "safe" | "review";
      source: "direct_request" | "conversation";
    },
    projects: Project[],
  ): Promise<void> {
    if (projects.length === 0) {
      await this.sendConversationReply(chatId, userId, "No projects are registered yet. Add a project first, then I can turn this into a task proposal.");
      return;
    }

    const project = this.resolveCreateTaskProject(proposal.projectId, projects);
    if (!project) {
      const session = this.getOrCreateSession(chatId, userId);
      session.pendingProjectSelection = {
        title: proposal.title,
        prompt: proposal.prompt,
        risk: proposal.risk,
        source: proposal.source,
      };
      session.updatedAt = Date.now();
      await this.sendConversationReply(chatId, userId, this.buildProjectChoiceMessage(projects));
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
      const task = await this.createTelegramTask(project.id, providerId, proposal.prompt);
      await this.sendConversationReply(chatId, userId, `✅ Task created: \`${task.id}\`\nPrompt: ${proposal.prompt.slice(0, 100)}`);
      return;
    }

    const now = Date.now();
    const confirmation: PendingTelegramConfirmation = {
      id: nanoid(),
      chatId,
      userId,
      type: "create_task",
      title: proposal.title,
      projectId: project.id,
      providerId,
      prompt: proposal.prompt,
      risk: proposal.risk,
      source: proposal.source,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CREATE_TASK_CONFIRMATION_TTL_MS).toISOString(),
    };
    this.pendingConfirmations.set(this.pendingConfirmationKey(chatId, userId), confirmation);
    await this.sendConversationReply(chatId, userId, this.formatTaskProposal(project, providerId, confirmation));
  }

  private async approvePendingTask(chatId: number, confirmation: PendingTelegramConfirmation): Promise<void> {
    const panic = getPanicState();
    if (panic.active) {
      await this.transport.sendMessage(chatId, "🚨 Panic mode is active. Task proposals cannot be approved right now.");
      return;
    }

    const task = await this.createTelegramTask(confirmation.projectId, confirmation.providerId, confirmation.prompt);
    this.pendingConfirmations.delete(this.pendingConfirmationKey(confirmation.chatId, confirmation.userId));
    await this.sendConversationReply(chatId, confirmation.userId, `✅ Task created: \`${task.id}\`\nPrompt: ${confirmation.prompt.slice(0, 100)}`);
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

  private async buildRunningSummary(projectId?: string): Promise<string> {
    const tasks = await this.services.tasks.listTasks(projectId);
    const activeTasks = tasks.filter((task) => task.status === "queued" || task.status === "running");
    if (activeTasks.length === 0) {
      return "Nothing is running right now.";
    }

    const lines = ["Active work:"];
    for (const task of activeTasks.slice(0, 5)) {
      lines.push(`- ${task.title} (${task.id}) [${task.status}]`);
    }
    return lines.join("\n");
  }

  private buildPanicStatusSummary(): string {
    const panic = getPanicState();
    if (!panic.active) {
      return "Panic mode is not active.";
    }
    return `Panic mode is active${panic.activatedAt ? ` since ${panic.activatedAt}` : ""}. I can discuss plans, but I cannot create or approve work until panic is resumed.`;
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

  private getSessionKey(chatId: number, userId: number): string {
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

  private getSession(chatId: number, userId: number): TelegramConversationSession | undefined {
    const session = this.sessions.get(this.getSessionKey(chatId, userId));
    if (!session) {
      return undefined;
    }
    if (Date.now() - session.updatedAt > CHAT_SESSION_TTL_MS) {
      this.sessions.delete(this.getSessionKey(chatId, userId));
      return undefined;
    }
    return session;
  }

  private getOrCreateSession(chatId: number, userId: number): TelegramConversationSession {
    const existing = this.getSession(chatId, userId);
    if (existing) {
      return existing;
    }
    const created: TelegramConversationSession = {
      messages: [],
      updatedAt: Date.now(),
    };
    this.sessions.set(this.getSessionKey(chatId, userId), created);
    return created;
  }

  private appendSessionMessage(chatId: number, userId: number, role: "user" | "assistant", content: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    const session = this.getOrCreateSession(chatId, userId);
    session.messages = [...session.messages, { role, content: trimmed, createdAt: Date.now() }].slice(-this.getChatMaxContextMessages());
    session.updatedAt = Date.now();
  }

  private clearPendingProposalState(chatId: number, userId: number): void {
    this.pendingConfirmations.delete(this.pendingConfirmationKey(chatId, userId));
    const session = this.getSession(chatId, userId);
    if (session) {
      delete session.pendingProjectSelection;
      session.updatedAt = Date.now();
    }
  }

  private clearConversationState(chatId: number, userId: number): void {
    this.pendingConfirmations.delete(this.pendingConfirmationKey(chatId, userId));
    this.sessions.delete(this.getSessionKey(chatId, userId));
  }

  private async sendConversationReply(chatId: number, userId: number, text: string): Promise<void> {
    await this.transport.sendMessage(chatId, text);
    this.appendSessionMessage(chatId, userId, "assistant", text);
  }

  private async editPendingProposal(chatId: number, userId: number, editInstruction: string): Promise<void> {
    if (!editInstruction) {
      await this.transport.sendMessage(chatId, "Use edit: <new instruction> to update the pending proposal.");
      return;
    }

    const pendingConfirmation = this.getPendingConfirmation(chatId, userId);
    if (pendingConfirmation) {
      pendingConfirmation.prompt = `${pendingConfirmation.prompt}\n\nEdit instruction: ${editInstruction}`;
      pendingConfirmation.title = this.buildTaskTitle(editInstruction);
      this.pendingConfirmations.set(this.pendingConfirmationKey(chatId, userId), pendingConfirmation);

      const projects = await this.services.projects.listProjects();
      const project = projects.find((entry) => entry.id === pendingConfirmation.projectId);
      if (!project) {
        throw new Error(`Project not found for pending proposal: ${pendingConfirmation.projectId}`);
      }

      await this.sendConversationReply(chatId, userId, this.formatTaskProposal(project, pendingConfirmation.providerId, pendingConfirmation));
      return;
    }

    const session = this.getSession(chatId, userId);
    if (session?.pendingProjectSelection) {
      session.pendingProjectSelection.prompt = `${session.pendingProjectSelection.prompt}\n\nEdit instruction: ${editInstruction}`;
      session.pendingProjectSelection.title = this.buildTaskTitle(editInstruction);
      session.updatedAt = Date.now();
      const projects = await this.services.projects.listProjects();
      await this.sendConversationReply(chatId, userId, this.buildProjectChoiceMessage(projects));
      return;
    }

    await this.transport.sendMessage(chatId, "I do not have a pending task proposal to edit yet.");
  }

  private async handlePendingProjectSelection(chatId: number, userId: number, text: string, projects: Project[]): Promise<boolean> {
    const session = this.getSession(chatId, userId);
    const pendingProjectSelection = session?.pendingProjectSelection;
    if (!pendingProjectSelection) {
      return false;
    }

    const normalized = normalizeTelegramText(text.replace(/^use\s+/i, "").trim());
    const chosenProject = findProjectMention(projects, normalized)
      ?? projects.find((project) => normalizeTelegramText(project.name) === normalized || normalizeTelegramText(project.id) === normalized);

    if (!chosenProject) {
      await this.sendConversationReply(chatId, userId, this.buildProjectChoiceMessage(projects));
      return true;
    }

    session.pendingProjectSelection = undefined;
    session.updatedAt = Date.now();
    await this.proposeTaskRequest(chatId, userId, {
      title: pendingProjectSelection.title,
      prompt: pendingProjectSelection.prompt,
      projectId: chosenProject.id,
      risk: pendingProjectSelection.risk,
      source: pendingProjectSelection.source,
    }, projects);
    return true;
  }

  private async proposeTaskFromConversation(chatId: number, userId: number, projects: Project[]): Promise<void> {
    const session = this.getSession(chatId, userId);
    if (!session || session.messages.length < 2) {
      await this.sendConversationReply(chatId, userId, "I do not have enough recent conversation to turn into a task yet. Tell me what you want to change first.");
      return;
    }

    const conversationPrompt = this.buildConversationTaskPrompt(session);
    if (!conversationPrompt) {
      await this.sendConversationReply(chatId, userId, "I do not have a concrete enough plan yet. Describe the change a bit more, then say 'do it' again.");
      return;
    }

    const projectMention = findProjectMention(projects, normalizeTelegramText(session.messages.map((message) => message.content).join(" ")));
    await this.proposeTaskRequest(chatId, userId, {
      title: conversationPrompt.title,
      prompt: conversationPrompt.prompt,
      projectId: projectMention?.id,
      risk: "review",
      source: "conversation",
    }, projects);
  }

  private buildConversationTaskPrompt(session: TelegramConversationSession): { title: string; prompt: string } | null {
    const relevantMessages = session.messages.slice(-Math.min(6, session.messages.length));
    const userMessages = relevantMessages.filter((message) => message.role === "user");
    if (userMessages.length === 0) {
      return null;
    }

    return {
      title: this.buildTaskTitle(userMessages[userMessages.length - 1]?.content ?? "Telegram follow-up"),
      prompt: [
        "Use this approved Telegram conversation as the task brief.",
        "Preserve the requested goal, constraints, and follow-up decisions.",
        "",
        ...relevantMessages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`),
      ].join("\n"),
    };
  }

  private async replyToConversation(
    chatId: number,
    userId: number,
    text: string,
    projects: Project[],
    pendingApprovals: Approval[],
  ): Promise<void> {
    const response = await this.generateConversationReply(chatId, userId, text, projects, pendingApprovals);
    await this.sendConversationReply(chatId, userId, response);
  }

  private async generateConversationReply(
    chatId: number,
    userId: number,
    text: string,
    projects: Project[],
    pendingApprovals: Approval[],
  ): Promise<string> {
    const providerReply = await this.tryProviderConversation(chatId, userId, projects, pendingApprovals);
    if (providerReply.text) {
      return providerReply.text;
    }
    return this.buildLocalConversationReply(text, projects, pendingApprovals, providerReply.note);
  }

  private async tryProviderConversation(
    chatId: number,
    userId: number,
    projects: Project[],
    pendingApprovals: Approval[],
  ): Promise<{ text?: string; note?: string }> {
    if (this.config.chat?.enabled === false) {
      return { note: "Telegram chat is configured for local-only replies right now." };
    }

    const configuredProviders = this.services.providers.list();
    const requestedProviderId = this.config.chat?.providerId ?? this.config.globalDefaultProviderId ?? this.config.defaultProviderId;
    if (!requestedProviderId) {
      return configuredProviders.length === 0
        ? { note: "I can still help locally, but richer provider-backed chat needs a configured provider. For now use /help, /actions, /projects, or add a provider in the dashboard." }
        : { note: "I can still help locally, but Telegram chat stays local until telegram.chat.providerId or providers.globalDefaultProviderId is set." };
    }

    const provider = configuredProviders.find((entry) => entry.id === requestedProviderId);
    if (!provider) {
      return { note: `Telegram chat provider '${requestedProviderId}' is not configured. I am using the local chat fallback.` };
    }

    if (typeof provider.startChat !== "function") {
      return provider.type === "codex-cli"
        ? { note: "Codex CLI is configured for task execution, but chat fallback is local-only right now." }
        : { note: `${provider.name} does not expose a chat-only Telegram path yet, so I am using the local fallback.` };
    }

    try {
      const systemPrompt = await this.buildChatSystemPrompt(projects, pendingApprovals, this.getSession(chatId, userId));
      const sessionMessages = (this.getSession(chatId, userId)?.messages ?? []).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const result = await provider.startChat({
        systemPrompt,
        messages: sessionMessages,
        maxOutputTokens: this.getChatMaxOutputTokens(),
      });
      return { text: result.text.trim() };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { note: `Provider-backed Telegram chat is temporarily unavailable (${errorMessage}). I am using the local fallback.` };
    }
  }

  private async buildChatSystemPrompt(
    projects: Project[],
    pendingApprovals: Approval[],
    session: TelegramConversationSession | undefined,
  ): Promise<string> {
    const panic = getPanicState();
    const providerSummary = this.services.providers.list()
      .map((provider) => `${provider.id} (${provider.type}${typeof provider.startChat === "function" ? ", chat" : ""})`)
      .join(", ") || "none";
    const projectSummary = projects.map((project) => `${project.name} (${project.id})`).join(", ") || "none";
    const memorySummary = await this.buildChatMemorySummary(projects, session);

    return [
      "You are Feather's Telegram conversation layer.",
      "You are chat-only. Do not run tools, shell, git, file writes, approvals, or tasks.",
      "You may help plan, spec, challenge, explain tradeoffs, and turn vague ideas into clearer next steps.",
      "If the user asks for work, do not pretend the work happened. Tell them Feather can create a task proposal that still needs explicit approval.",
      "Do not claim to have read repo files, logs, raw config, DB contents, secrets, or task payloads unless they are explicitly present in the bounded context below.",
      panic.active
        ? "Panic is active. You may discuss plans and explain status, but you must not create or approve work."
        : "Panic is inactive. Conversation is still chat-only until the operator explicitly asks Feather to create a task proposal.",
      "",
      "Bounded Feather context:",
      `- Panic: ${panic.active ? "active" : "inactive"}`,
      `- Pending approvals: ${pendingApprovals.length}`,
      `- Projects: ${projectSummary}`,
      `- Providers: ${providerSummary}`,
      `- Explicit memories: ${memorySummary}`,
      "",
      "Feather can answer local status questions, discuss plans, and create task proposals for later approval. It cannot bypass panic, approvals, budgets, denied paths, or provider routing from chat.",
      "Keep replies concise, practical, and operator-facing.",
    ].join("\n");
  }

  private async buildChatMemorySummary(projects: Project[], session: TelegramConversationSession | undefined): Promise<string> {
    try {
      const globalMemories = await this.services.memories.list({ scope: "global" });
      const projectId = this.findConversationProjectId(projects, session);
      const projectMemories = projectId
        ? await this.services.memories.list({ scope: "project", projectId })
        : [];
      const summary = [
        ...globalMemories.slice(0, 2).map((memory) => `[global/${memory.kind}] ${truncateText(memory.content, 100)}`),
        ...projectMemories.slice(0, 2).map((memory) => `[project/${memory.kind}] ${truncateText(memory.content, 100)}`),
      ];
      return summary.join(" | ") || "none";
    } catch {
      return "unavailable";
    }
  }

  private findConversationProjectId(projects: Project[], session: TelegramConversationSession | undefined): string | undefined {
    if (!session || session.messages.length === 0) {
      return undefined;
    }
    return findProjectMention(projects, normalizeTelegramText(session.messages.map((message) => message.content).join(" ")))
      ?.id;
  }

  private buildLocalConversationReply(
    text: string,
    projects: Project[],
    pendingApprovals: Approval[],
    providerNote?: string,
  ): string {
    const normalized = normalizeTelegramText(text);
    const panic = getPanicState();
    const projectSummary = projects.length > 0
      ? `Registered projects: ${projects.map((project) => project.name).join(", ")}.`
      : "No projects are registered yet.";
    const approvalSummary = pendingApprovals.length > 0
      ? `Pending approvals: ${pendingApprovals.length}.`
      : "No approvals are waiting right now.";
    const panicNote = panic.active
      ? " Panic is active, so I can discuss plans but I cannot create or approve work until panic is resumed."
      : "";
    const noteSuffix = providerNote ? `\n\n${providerNote}` : "";

    if (/^(hi|hello|hey)\b/.test(normalized)) {
      return `Hi. I can help you think through plans, pressure-test an idea, answer Feather state questions, and turn a concrete request into a task proposal that still needs your approval before it starts. ${projectSummary} ${approvalSummary}${panicNote}${noteSuffix}`.trim();
    }

    if (normalized.includes("what can you do") || normalized.includes("what do you do")) {
      return `I can answer local status questions, talk through scope, risks, and tradeoffs, and turn a concrete change into a task proposal. I do not run tools or touch project files from chat. Once you approve a proposal, the normal TaskRunner, approvals, budgets, panic checks, and provider routing still apply.${panicNote}${noteSuffix}`;
    }

    if (normalized.includes("help me think") || normalized.includes("spec this") || normalized.includes("how should i use this")) {
      return `Start with the outcome, scope, constraints, and what done looks like. I can help tighten the brief, call out blind spots, and then turn the plan into a task proposal when you are ready.${panicNote}${noteSuffix}`;
    }

    if (normalized.includes("challenge this plan") || normalized.includes("what are the risks") || normalized.includes("risks")) {
      return `The main things I would pressure-test are scope creep, approval-heavy steps, rollback, validation cost, and whether the task is small enough to supervise safely. Give me the plan in one or two lines and I will challenge it directly.${panicNote}${noteSuffix}`;
    }

    if (normalized.includes("how do we turn this into a task") || normalized.includes("turn this into a task")) {
      return `Make the goal concrete, name the project if it is ambiguous, and state any constraints. When the brief is ready, say 'create the task' or 'do it' and I will draft a proposal for approval.${panicNote}${noteSuffix}`;
    }

    return `I can talk through the plan, constraints, risks, and next step, then turn it into a task proposal when you are ready. If you want local state, ask about projects, approvals, budget, running tasks, or panic state.${panicNote}${noteSuffix}`;
  }

  private buildTaskTitle(prompt: string): string {
    const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() ?? "Telegram task";
    return firstLine.slice(0, 60) || "Telegram task";
  }

  private formatTaskProposal(project: Project, providerId: string | undefined, confirmation: PendingTelegramConfirmation): string {
    return [
      "I can create this as a task.",
      "",
      `Title: ${confirmation.title}`,
      `Project: ${project.name}`,
      `Provider: ${providerId ?? "unresolved"}`,
      `Risk: ${confirmation.risk === "review" ? "may write files / run shell" : "safe"}`,
      `Prompt preview: ${truncateText(confirmation.prompt, 280)}`,
      `Source: ${confirmation.source === "conversation" ? "recent Telegram conversation" : "direct Telegram request"}`,
      "",
      "Reply approve task or edit: <new instruction> or cancel.",
    ].join("\n");
  }

  private buildProjectChoiceMessage(projects: Project[]): string {
    return `I can propose that as a task. Which project should I use? ${projects.map((project) => `${project.name} (${project.id})`).join(", ")}`;
  }

  private getChatMaxContextMessages(): number {
    return Math.max(4, Math.min(this.config.chat?.maxContextMessages ?? 12, 20));
  }

  private getChatMaxOutputTokens(): number {
    return Math.max(128, Math.min(this.config.chat?.maxOutputTokens ?? 700, 1400));
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
      case "conversation":
      case "clear_chat":
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
      case "/clear-chat":
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
