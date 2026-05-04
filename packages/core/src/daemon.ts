import pino from "pino";
import { initDb } from "./db/index.js";
import { loadGlobalConfig } from "./config/index.js";
import { ProjectService } from "./projects/index.js";
import { ApprovalService } from "./approvals/index.js";
import { TaskRunner } from "./task-runner/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import { ProviderConfigService } from "./providers/service.js";
import { BudgetService } from "./budgets/index.js";
import { createApiServer } from "./api/index.js";
import { TelegramConnector } from "./telegram/index.js";
import { FEATHER_HOST, FEATHER_PORT } from "@feather/shared";
import path from "node:path";
import os from "node:os";

export async function startDaemon(options?: { port?: number; dbPath?: string }) {
  const logger = pino({ level: "info" });

  const globalConfig = loadGlobalConfig();
  const dbPath = options?.dbPath ?? globalConfig.dbPath ?? path.join(os.homedir(), ".feather", "feather.db");
  const port = options?.port ?? globalConfig.daemonPort ?? FEATHER_PORT;

  logger.info({ dbPath, port }, "Starting Feather daemon");

  initDb(dbPath);

  const projects = new ProjectService();
  const approvals = new ApprovalService();
  const providers = new ProviderRegistry();
  const providerConfigs = new ProviderConfigService(providers);
  const budgets = new BudgetService();
  const tasks = new TaskRunner(providers, projects, approvals, budgets);
  const heartbeat = new HeartbeatService(projects, approvals);

  await providerConfigs.loadIntoRegistry();
  const recovery = await tasks.recoverTasksOnStartup();
  if (recovery.resumedQueued > 0 || recovery.restartedRunning > 0 || recovery.pendingApproval > 0) {
    logger.info({ recovery }, "Recovered persisted tasks after daemon startup");
  }

  const app = await createApiServer({
    projects,
    tasks,
    approvals,
    heartbeat,
    providers,
    providerConfigs,
    budgets,
    logger,
  });

  await app.listen({ port, host: FEATHER_HOST });
  logger.info(`Feather daemon running at http://${FEATHER_HOST}:${port}`);

  // Start heartbeat in passive mode
  heartbeat.start(30);

  // Start Telegram connector if configured
  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"] ?? globalConfig.telegramBotToken;
  const telegramAllowedIds = process.env["TELEGRAM_ALLOWED_USER_IDS"];
  let telegram: TelegramConnector | undefined;
  if (telegramToken) {
    const allowedUserIds = telegramAllowedIds
      ? telegramAllowedIds.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
      : globalConfig.allowedTelegramUserIds ?? [];
    if (allowedUserIds.length > 0) {
      telegram = new TelegramConnector(
        { botToken: telegramToken, allowedUserIds },
        { approvals, projects, tasks, budgets, heartbeat, providers },
      );
      telegram.start();
      logger.info({ allowedUserIds }, "Telegram connector started");
    }
  }

  return { app, projects, tasks, approvals, heartbeat, providers, providerConfigs, budgets, telegram };
}
