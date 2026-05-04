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
 *   /help            - Command reference
 */

import https from "node:https";
import type { ApprovalService } from "../approvals/index.js";
import type { ProjectService } from "../projects/index.js";
import type { TaskRunner } from "../task-runner/index.js";
import type { BudgetService } from "../budgets/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { getPanicState, activatePanic, deactivatePanic } from "../panic/index.js";
import { resolveTaskProviderId } from "../providers/routing.js";

export type TelegramConfig = {
  botToken: string;
  allowedUserIds: number[];
  globalDefaultProviderId?: string;
  allowSingleProviderAutoRoute?: boolean;
  /** @deprecated Use globalDefaultProviderId. */
  defaultProviderId?: string;
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
};

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
  private offset = 0;
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private lastPollError = "";

  constructor(config: TelegramConfig, services: TelegramServices) {
    this.config = config;
    this.services = services;
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
      const updates = await getUpdates(this.config.botToken, this.offset);
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
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text ?? "").trim();

    if (!this.isAllowedUser(userId)) {
      await sendMessage(this.config.botToken, chatId, "❌ Unauthorized. This Feather instance does not allow your user ID.");
      return;
    }

    const [cmdRaw, ...args] = text.split(" ");
    const cmd = cmdRaw ?? "";
    const panic = getPanicState();

    if (panic.active && !this.isAllowedDuringPanic(cmd, args)) {
      await sendMessage(this.config.botToken, chatId, "🚨 Panic mode is active. Only safe read-only commands are allowed.");
      return;
    }

    try {
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
        case "/panic":    await this.cmdPanic(chatId); break;
        case "/resume":   await this.cmdResume(chatId, args); break;
        case "/cancel":   await this.cmdCancelTask(chatId, args[0]); break;
        default:
          await sendMessage(this.config.botToken, chatId, "Unknown command. Use /help.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendMessage(this.config.botToken, chatId, `❌ Error: ${msg}`);
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
    await sendMessage(this.config.botToken, chatId, lines.join("\n"));
  }

  private async cmdProjects(chatId: number): Promise<void> {
    const projects = await this.services.projects.listProjects();
    if (projects.length === 0) {
      await sendMessage(this.config.botToken, chatId, "No projects registered.");
      return;
    }
    const lines = ["*Projects*", ...projects.map((p) => `• ${p.name} — \`${p.rootPath}\``)];
    await sendMessage(this.config.botToken, chatId, lines.join("\n"));
  }

  private async cmdTask(chatId: number, args: string[]): Promise<void> {
    if (args.length < 2) {
      await sendMessage(this.config.botToken, chatId, "Usage: /task <project-name> <prompt>");
      return;
    }
    const [projectNameRaw, ...promptParts] = args;
    const projectName = projectNameRaw ?? "";
    const prompt = promptParts.join(" ");

    const projects = await this.services.projects.listProjects();
    const project = projects.find((p) => p.name === projectName || p.id === projectName);
    if (!project) {
      await sendMessage(this.config.botToken, chatId, `Project not found: ${projectName}`);
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
    await sendMessage(this.config.botToken, chatId, `✅ Task created: \`${task.id}\`\nPrompt: ${prompt.slice(0, 100)}`);
  }

  private async cmdApprovals(chatId: number): Promise<void> {
    const pending = await this.services.approvals.getPendingApprovals();
    if (pending.length === 0) {
      await sendMessage(this.config.botToken, chatId, "No pending approvals.");
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
    await sendMessage(this.config.botToken, chatId, lines.join("\n"));
  }

  private async cmdApprove(chatId: number, id: string | undefined): Promise<void> {
    if (!id) {
      await sendMessage(this.config.botToken, chatId, "Usage: /approve <approval-id>");
      return;
    }
    await this.services.approvals.resolveApproval(id, "approved", "once");
    await sendMessage(this.config.botToken, chatId, `✅ Approved: \`${id}\``);
  }

  private async cmdReject(chatId: number, id: string | undefined): Promise<void> {
    if (!id) {
      await sendMessage(this.config.botToken, chatId, "Usage: /reject <approval-id>");
      return;
    }
    await this.services.approvals.resolveApproval(id, "rejected");
    await sendMessage(this.config.botToken, chatId, `❌ Rejected: \`${id}\``);
  }

  private async cmdRecap(chatId: number, projectName: string | undefined): Promise<void> {
    if (!projectName) {
      await sendMessage(this.config.botToken, chatId, "Usage: /recap <project-name>");
      return;
    }
    const projects = await this.services.projects.listProjects();
    const project = projects.find((p) => p.name === projectName || p.id === projectName);
    if (!project) {
      await sendMessage(this.config.botToken, chatId, `Project not found: ${projectName}`);
      return;
    }
    const recap = await this.services.heartbeat.generateDailyRecap(project.id);
    await sendMessage(this.config.botToken, chatId, recap);
  }

  private async cmdHeartbeat(chatId: number, args: string[]): Promise<void> {
    // /heartbeat <project> on|off — placeholder; heartbeat is global in v0.1
    const [, action] = args;
    if (action === "on") {
      this.services.heartbeat.start(30);
      await sendMessage(this.config.botToken, chatId, "✅ Heartbeat started.");
    } else if (action === "off") {
      this.services.heartbeat.stop();
      await sendMessage(this.config.botToken, chatId, "⏹ Heartbeat stopped.");
    } else {
      await sendMessage(this.config.botToken, chatId, "Usage: /heartbeat <project> on|off");
    }
  }

  private async cmdBudget(chatId: number): Promise<void> {
    const spend = await this.services.budgets.getDailySpendCents();
    const dollars = (spend / 100).toFixed(2);
    await sendMessage(this.config.botToken, chatId, `💰 Daily spend: $${dollars}`);
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
      "/help — This message",
      "",
      "*Safety commands*",
      "/panic — Activate panic mode (cancels all tasks)",
      "/resume confirm — Deactivate panic mode",
      "/cancel <taskId> — Cancel a specific task",
    ];
    await sendMessage(this.config.botToken, chatId, lines.join("\n"));
  }

  private async cmdPanic(chatId: number): Promise<void> {
    await activatePanic("Telegram /panic command");
    await this.services.tasks.cancelAllActive("panic");
    this.services.heartbeat.stop();
    await sendMessage(this.config.botToken, chatId, "🚨 Panic mode activated. All active tasks have been cancelled. Send /resume confirm to resume.");
  }

  private async cmdResume(chatId: number, args: string[]): Promise<void> {
    if (args[0] !== "confirm") {
      await sendMessage(this.config.botToken, chatId, "⚠️ To deactivate panic mode, send exactly: /resume confirm");
      return;
    }
    await deactivatePanic();
    this.services.heartbeat.start(30);
    await sendMessage(this.config.botToken, chatId, "✅ Panic mode deactivated. Daemon is running normally.");
  }

  private async cmdCancelTask(chatId: number, taskId: string | undefined): Promise<void> {
    if (!taskId) {
      await sendMessage(this.config.botToken, chatId, "Usage: /cancel <taskId>");
      return;
    }
    await this.services.tasks.cancelTask(taskId, "cancelled");
    await sendMessage(this.config.botToken, chatId, `🛑 Task \`${taskId}\` cancelled.`);
  }

  /**
   * Send an approval notification to all allowed users.
   */
  async notifyApproval(approvalId: string, title: string, project: string, action: string, risk: string, reason: string): Promise<void> {
    const text = [
      "*Feather approval needed*",
      "",
      `Project: ${project}`,
      `Action: ${action}`,
      `Risk: ${risk}`,
      `Reason: ${reason}`,
      "",
      `Approve once: /approve ${approvalId}`,
      `Reject: /reject ${approvalId}`,
    ].join("\n");

    for (const userId of this.config.allowedUserIds) {
      await sendMessage(this.config.botToken, userId, text);
    }
  }

  private isAllowedDuringPanic(cmd: string, args: string[]): boolean {
    switch (cmd) {
      case "/status":
      case "/projects":
      case "/approvals":
      case "/budget":
      case "/help":
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
