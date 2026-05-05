import pino from "pino";
import { initDb } from "./db/index.js";
import { getProviderRoutingConfig, loadGlobalConfig } from "./config/index.js";
import { ProjectService } from "./projects/index.js";
import { ApprovalService } from "./approvals/index.js";
import { TaskRunner } from "./task-runner/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import { ProviderConfigService } from "./providers/service.js";
import { BudgetService } from "./budgets/index.js";
import { createApiServer } from "./api/index.js";
import { TelegramConnector } from "./telegram/index.js";
import { MemoryService } from "./memories/index.js";
import { SkillService } from "./skills/index.js";
import { FEATHER_HOST, FEATHER_PORT } from "@feather/shared";
import { loadPanicStateFromDb, getPanicState } from "./panic/index.js";
import { loadFeatherLocalSecretsIntoProcess } from "./secrets/index.js";
import path from "node:path";
import os from "node:os";

export async function startDaemon(options?: { port?: number; dbPath?: string }) {
  const logger = pino({ level: "info" });

  const loadedSecrets = loadFeatherLocalSecretsIntoProcess();
  if (loadedSecrets.length > 0) {
    logger.info({ count: loadedSecrets.length }, "Loaded local Feather secrets into process env");
  }

  const globalConfig = loadGlobalConfig();
  const dbPath = options?.dbPath ?? globalConfig.dbPath ?? path.join(os.homedir(), ".feather", "feather.db");
  const port = options?.port ?? globalConfig.daemonPort ?? FEATHER_PORT;

  logger.info({ dbPath, port }, "Starting Feather daemon");

  initDb(dbPath);

  // Restore panic state from DB BEFORE anything else so guards are correct.
  await loadPanicStateFromDb();
  const panicOnStartup = getPanicState();
  if (panicOnStartup.active) {
    logger.warn({ activatedAt: panicOnStartup.activatedAt }, "Daemon restarted while panic mode was active — holding in panic");
  }

  const projects = new ProjectService();
  const approvals = new ApprovalService();
  const providers = new ProviderRegistry();
  const providerConfigs = new ProviderConfigService(providers);
  const budgets = new BudgetService();
  const memories = new MemoryService();
  const skills = new SkillService(projects);
  const tasks = new TaskRunner(providers, projects, approvals, budgets, { memories, skills });
  const heartbeat = new HeartbeatService(projects, approvals, memories);

  await providerConfigs.loadIntoRegistry();
  if (!panicOnStartup.active) {
    const recovery = await tasks.recoverTasksOnStartup();
    if (recovery.keptQueued > 0 || recovery.cancelledRunning > 0 || recovery.pendingApproval > 0) {
      logger.info({ recovery }, "Recovered persisted tasks after daemon startup");
    }
  } else {
    logger.warn(
      "Task recovery skipped because panic mode is active. Resume first, then inspect tasks manually.",
    );
  }

  const app = await createApiServer({
    projects,
    tasks,
    approvals,
    heartbeat,
    providers,
    providerConfigs,
    budgets,
    memories,
    skills,
    logger,
  });

  await app.listen({ port, host: FEATHER_HOST });
  logger.info(`Feather daemon running at http://${FEATHER_HOST}:${port}`);

  // Start heartbeat in passive mode
  if (!panicOnStartup.active) {
    heartbeat.start();
  } else {
    logger.warn("Heartbeat NOT started — panic mode is active. Resume with /resume confirm or deactivatePanic().");
  }

  // Start Telegram connector if configured
  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"] ?? globalConfig.telegramBotToken;
  const routingConfig = getProviderRoutingConfig(globalConfig);
  const telegramAllowedIds = process.env["TELEGRAM_ALLOWED_USER_IDS"];
  let telegram: TelegramConnector | undefined;
  if (telegramToken) {
    const allowedUserIds = telegramAllowedIds
      ? telegramAllowedIds.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
      : globalConfig.allowedTelegramUserIds ?? [];
    if (allowedUserIds.length > 0) {
      telegram = new TelegramConnector(
        {
          botToken: telegramToken,
          allowedUserIds,
          globalDefaultProviderId: routingConfig.globalDefaultProviderId,
          allowSingleProviderAutoRoute: routingConfig.allowSingleProviderAutoRoute,
          freeform: globalConfig.telegram?.freeform,
          chat: globalConfig.telegram?.chat,
        },
        { approvals, projects, tasks, budgets, heartbeat, providers, memories, skills },
      );
      telegram.start();
      logger.info({ allowedUserIds }, "Telegram connector started");

      // P4: Wire approval notifications to Telegram.
      approvals.setApprovalCreatedHook(async (approval) => {
        const project = approval.projectId
          ? await projects.getProject(approval.projectId).catch(() => null)
          : null;
        await telegram!.notifyApproval(
          approval.id,
          approval.title,
          project?.name ?? "unknown",
          approval.actionType,
          approval.risk,
          approval.reason,
        ).catch((err: unknown) => {
          logger.warn({ err }, "Failed to send Telegram approval notification");
        });
      });
    }
  }

  return { app, projects, tasks, approvals, heartbeat, providers, providerConfigs, budgets, memories, skills, telegram };
}
