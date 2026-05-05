import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRunner } from "../task-runner/index.js";
import type { ProjectService } from "../projects/index.js";
import type { ApprovalService } from "../approvals/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderConfigService } from "../providers/service.js";
import type { BudgetService } from "../budgets/index.js";
import type { MemoryService } from "../memories/index.js";
import type { SkillService } from "../skills/index.js";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  CreateTaskRequestSchema,
  ResolveApprovalRequestSchema,
  FEATHER_HOST,
  FEATHER_PORT,
} from "@feather/shared";
import { ValidationError } from "@feather/shared";
import { getPanicState, activatePanic, deactivatePanic, assertNotPanic } from "../panic/index.js";
import { FeatherError } from "@feather/shared";
import type { Logger } from "pino";
import { resolveTaskProviderId } from "../providers/routing.js";
import {
  getFeatherHomeDir,
  getGlobalAgentFilePath,
  getGlobalConfigPath,
  getProviderRoutingConfig,
  loadGlobalAgentInstructions,
  loadGlobalConfig,
  loadProjectFileConfig,
  saveGlobalAgentInstructions,
  saveGlobalConfig,
  updateProjectHeartbeatConfig,
} from "../config/index.js";
import { buildAgentMarkdown, deriveOnboardingState, extractAgentName, normalizeOnboardingList } from "../onboarding/index.js";
import { getDb } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { readGuardLocks } from "../guard/locks.js";
import { LifecycleRequestSchema, writeLifecycleRequest } from "../guard/requests.js";
import { FEATHER_TOOL_NAMES } from "../tools/registry.js";
import { deriveProviderLocalApiKeyEnvName, upsertFeatherLocalSecret } from "../secrets/index.js";

export type ApiServices = {
  projects: ProjectService;
  tasks: TaskRunner;
  approvals: ApprovalService;
  heartbeat: HeartbeatService;
  providers: ProviderRegistry;
  providerConfigs: ProviderConfigService;
  budgets: BudgetService;
  memories: MemoryService;
  skills: SkillService;
  logger: Logger;
};

const MemoryRequestSchema = z.object({
  scope: z.enum(["global", "project"]),
  projectId: z.string().min(1).optional(),
  kind: z.enum(["preference", "fact", "decision", "constraint", "workflow"]),
  content: z.string().trim().min(1),
  sourceTaskId: z.string().min(1).optional(),
});

const UpdateMemoryRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  kind: z.enum(["preference", "fact", "decision", "constraint", "workflow"]).optional(),
  content: z.string().trim().min(1).optional(),
});

const SkillRequestSchema = z.object({
  scope: z.enum(["global", "project"]),
  projectId: z.string().min(1).optional(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  purpose: z.string().trim().optional(),
  allowedTools: z.array(z.string().trim().min(1)).default([]),
  instructions: z.string().trim().min(1),
  output: z.string().trim().optional(),
});

const UpdateSkillRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  purpose: z.string().trim().optional(),
  allowedTools: z.array(z.string().trim().min(1)).optional(),
  instructions: z.string().trim().min(1).optional(),
  output: z.string().trim().optional(),
});

const ProviderConfigRequestSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("codex-cli"),
    enabled: z.boolean().optional(),
    command: z.string().min(1).optional(),
    mode: z.enum(["exec", "apply"]).optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("openai"),
    enabled: z.boolean().optional(),
    credentialMode: z.enum(["env", "local"]).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    apiKeyValue: z.string().min(1).optional(),
    model: z.string().min(1),
    maxTaskCents: z.number().int().positive().optional(),
    baseUrl: z.string().url().optional(),
    inputCentsPer1MTokens: z.number().nonnegative().optional(),
    outputCentsPer1MTokens: z.number().nonnegative().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("openai-compatible"),
    enabled: z.boolean().optional(),
    baseUrl: z.string().url(),
    credentialMode: z.enum(["env", "local"]).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    apiKeyValue: z.string().min(1).optional(),
    model: z.string().min(1),
    maxTaskCents: z.number().int().positive().optional(),
    inputCentsPer1MTokens: z.number().nonnegative().optional(),
    outputCentsPer1MTokens: z.number().nonnegative().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("openrouter"),
    enabled: z.boolean().optional(),
    credentialMode: z.enum(["env", "local"]).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    apiKeyValue: z.string().min(1).optional(),
    model: z.string().min(1),
    maxTaskCents: z.number().int().positive().optional(),
    inputCentsPer1MTokens: z.number().nonnegative().optional(),
    outputCentsPer1MTokens: z.number().nonnegative().optional(),
  }),
]);

const UpdateProjectRequestSchema = z.object({
  name: z.string().min(1).optional(),
  defaultProviderId: z.string().min(1).nullable().optional(),
  codingProviderId: z.string().min(1).nullable().optional(),
  planningProviderId: z.string().min(1).nullable().optional(),
  heartbeatEnabled: z.boolean().optional(),
});

const MachineSetupRequestSchema = z.object({
  provider: ProviderConfigRequestSchema.optional(),
  project: z.object({
    name: z.string().min(1),
    rootPath: z.string().min(1),
    codingProviderId: z.string().min(1).optional(),
  }).optional(),
  telegram: z.object({
    enabled: z.boolean(),
    botToken: z.string().min(1).optional(),
    allowedUserIds: z.array(z.number().int().positive()).optional(),
  }),
});

const AgentProfileRequestSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  mission: z.string().min(1),
  tone: z.string().min(1),
  autonomy: z.string().min(1),
  boundaries: z.union([z.string(), z.array(z.string())]),
  workflow: z.union([z.string(), z.array(z.string())]),
  reporting: z.string().min(1),
});

type ProviderConfigRequest = z.infer<typeof ProviderConfigRequestSchema>;
type ProviderConfigType = ProviderConfigRequest["type"];

export async function createApiServer(services: ApiServices) {
  const dashboardDistDir = fileURLToPath(new URL("../../../../apps/dashboard/dist/", import.meta.url));
  const app = Fastify({
    loggerInstance: services.logger,
  });

  await app.register(cors, {
    origin: [`http://${FEATHER_HOST}:${FEATHER_PORT}`, "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  });

  await app.register(websocket);

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    done(null, text.trim() ? Object.fromEntries(new URLSearchParams(text)) : {});
  });

  // Error handler
  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error }, "API request failed");
    if (error instanceof FeatherError) {
      void reply.status(error.statusCode).send({ error: error.message, code: error.code });
    } else if (error instanceof z.ZodError) {
      void reply.status(400).send({ error: "Invalid request body", issues: error.issues });
    } else {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
      const code = typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
      const message = error instanceof Error ? error.message : "Internal server error";
      void reply.status(statusCode).send({
        error: statusCode < 500 ? message : "Internal server error",
        ...(code ? { code } : {}),
      });
    }
  });

  // ── Health ──────────────────────────────────────────────────────────────
  app.get("/health", async () => getStructuredHealth(services));

  app.post("/diagnostics/noop", { bodyLimit: 1024 }, async () => runNoopDiagnostic(services));

  app.post<{ Body: unknown }>("/lifecycle/requests", async (req) => {
    assertNotPanic();
    const queued = writeLifecycleRequest(LifecycleRequestSchema.parse(req.body));
    return {
      ok: true,
      requestId: queued.id,
      requestPath: queued.path,
      request: queued.request,
    };
  });

  // ── Onboarding ──────────────────────────────────────────────────────────
  app.get("/onboarding/state", async () => ({
    state: await getOnboardingState(services),
  }));

  app.post<{ Body: unknown }>("/onboarding/machine-setup", async (req) => {
    assertNotPanic();
    const input = MachineSetupRequestSchema.parse(req.body);

    const globalConfig = loadGlobalConfig();
    saveGlobalConfig(globalConfig);

    let providerId = input.provider?.id;
    let providerSelectionSource: "request" | "global-default" | "single-enabled-provider" | "none" = input.provider
      ? "request"
      : "none";
    if (input.provider) {
      await services.providerConfigs.upsert({
        id: input.provider.id,
        name: input.provider.name,
        type: input.provider.type,
        enabled: input.provider.enabled,
        config: buildStoredProviderConfig(input.provider),
      });
    }

    const enabledProviders = (await services.providerConfigs.list()).filter((provider) => provider.enabled);
    const existingRoutingConfig = getProviderRoutingConfig(globalConfig);
    if (!providerId) {
      const globalDefaultProviderId = existingRoutingConfig.globalDefaultProviderId;
      if (globalDefaultProviderId && enabledProviders.some((provider) => provider.id === globalDefaultProviderId)) {
        providerId = globalDefaultProviderId;
        providerSelectionSource = "global-default";
      } else if (enabledProviders.length === 1) {
        providerId = enabledProviders[0]!.id;
        providerSelectionSource = "single-enabled-provider";
      }
    }

    if (input.project) {
      const existingProject = await services.projects.getProjectByPath(input.project.rootPath);
      if (existingProject) {
        await services.projects.updateProject(existingProject.id, {
          name: input.project.name,
          ...(providerId ? { codingProviderId: input.project.codingProviderId ?? providerId } : {}),
        });
      } else {
        const createdProject = await services.projects.addProject({
          name: input.project.name,
          rootPath: input.project.rootPath,
          ...(providerId ? { defaultProviderId: providerId } : {}),
        });
        if (providerId) {
          await services.projects.updateProject(createdProject.id, {
            codingProviderId: input.project.codingProviderId ?? providerId,
          });
        }
      }
    }

    const projects = await services.projects.listProjects();
    if (enabledProviders.length === 0) {
      throw new ValidationError("Configure at least one enabled provider to continue onboarding.");
    }
    if (projects.length === 0) {
      throw new ValidationError("Register at least one project to continue onboarding.");
    }

    if (input.telegram.botToken) {
      upsertFeatherLocalSecret("TELEGRAM_BOT_TOKEN", input.telegram.botToken);
    }

    const effectiveTelegramToken = input.telegram.botToken ?? process.env["TELEGRAM_BOT_TOKEN"] ?? globalConfig.telegramBotToken;
    const effectiveTelegramUserIds = input.telegram.allowedUserIds ?? globalConfig.allowedTelegramUserIds ?? [];

    if (input.telegram.enabled && (!effectiveTelegramToken || effectiveTelegramUserIds.length === 0)) {
      throw new ValidationError("Telegram setup requires a bot token and at least one allowed Telegram user ID.");
    }

    saveGlobalConfig({
      ...globalConfig,
      providers: {
        ...(globalConfig.providers ?? {}),
        ...(providerId ? { globalDefaultProviderId: providerId } : {}),
        allowSingleProviderAutoRoute: globalConfig.providers?.allowSingleProviderAutoRoute === true,
      },
      ...(input.telegram.enabled
        ? {
            telegramBotToken: input.telegram.botToken ? undefined : effectiveTelegramToken,
            allowedTelegramUserIds: effectiveTelegramUserIds,
          }
        : {}),
      onboarding: {
        ...globalConfig.onboarding,
        machineSetupCompleted: true,
        telegramStepCompleted: true,
        telegramEnabled: input.telegram.enabled,
        completedAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      state: await getOnboardingState(services),
      requiresDaemonRestart: input.telegram.enabled,
      routing: {
        globalDefaultProviderId: providerId ?? null,
        providerSelectionSource,
      },
    };
  });

  app.post<{ Body: unknown }>("/onboarding/agent-profile", async (req) => {
    assertNotPanic();
    const input = AgentProfileRequestSchema.parse(req.body);
    const content = buildAgentMarkdown({
      name: input.name,
      role: input.role,
      mission: input.mission,
      tone: input.tone,
      autonomy: input.autonomy,
      boundaries: normalizeOnboardingList(input.boundaries),
      workflow: normalizeOnboardingList(input.workflow),
      reporting: input.reporting,
    });

    saveGlobalAgentInstructions(content);
    const globalConfig = loadGlobalConfig();
    saveGlobalConfig({
      ...globalConfig,
      onboarding: {
        ...globalConfig.onboarding,
        agentSetupCompleted: true,
        completedAt: new Date().toISOString(),
      },
    });

    return {
      ok: true,
      agentPath: getGlobalAgentFilePath(),
      content,
      state: await getOnboardingState(services),
    };
  });

  // ── Panic ────────────────────────────────────────────────────────────────
  app.post("/panic", async () => {
    await activatePanic("Dashboard panic button");
    await services.tasks.cancelAllActive("panic");
    services.heartbeat.stop();
    return { ok: true };
  });

  app.post("/resume", async () => {
    await deactivatePanic();
    services.heartbeat.start();
    return { ok: true };
  });

  // ── Projects ─────────────────────────────────────────────────────────────
  app.get("/projects", async () => {
    const list = await services.projects.listProjects();
    return { projects: list };
  });

  app.post<{ Body: { name: string; rootPath: string; defaultProviderId?: string } }>(
    "/projects",
    async (req) => {
      assertNotPanic();
      const project = await services.projects.addProject(req.body);
      return { project };
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>("/projects/:id", async (req) => {
    assertNotPanic();
    const input = UpdateProjectRequestSchema.parse(req.body);
    const project = await services.projects.updateProject(req.params.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.defaultProviderId !== undefined ? { defaultProviderId: input.defaultProviderId } : {}),
      ...(input.codingProviderId !== undefined ? { codingProviderId: input.codingProviderId } : {}),
      ...(input.planningProviderId !== undefined ? { planningProviderId: input.planningProviderId } : {}),
      ...(input.heartbeatEnabled !== undefined ? { heartbeatEnabled: input.heartbeatEnabled } : {}),
    });
    return { project };
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const project = await services.projects.getProject(req.params.id);
    return { project };
  });

  app.get<{ Params: { id: string } }>("/projects/:id/config", async (req) => {
    const config = await services.projects.getProjectConfig(req.params.id);
    return { config };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/projects/:id/heartbeat", async (req) => {
    assertNotPanic();
    const project = await services.projects.getProject(req.params.id);
    const input = z.object({
      enabled: z.boolean(),
      mode: z.enum(["off", "manual", "passive", "proactive"]),
      intervalMinutes: z.number().int().positive(),
      quietHours: z.object({ start: z.string(), end: z.string() }).optional(),
      checks: z.object({
        git_dirty: z.object({ enabled: z.boolean(), cooldownMinutes: z.number().int().nonnegative() }),
        pending_approvals: z.object({ enabled: z.boolean(), cooldownMinutes: z.number().int().nonnegative() }),
        daily_recap: z.object({ enabled: z.boolean(), time: z.string().optional() }),
      }),
      instructions: z.array(z.string()),
    }).parse(req.body);
    const current = loadProjectFileConfig(project.rootPath);
    const next = updateProjectHeartbeatConfig(project.rootPath, {
      ...(current?.heartbeat ?? {}),
      enabled: input.enabled,
      mode: input.mode,
      intervalMinutes: input.intervalMinutes,
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      checks: {
        git_dirty: input.checks.git_dirty,
        pending_approvals: input.checks.pending_approvals,
        daily_recap: input.checks.daily_recap,
      },
      instructions: input.instructions,
    });
    return { config: next };
  });

  app.get<{ Params: { id: string } }>("/projects/:id/recap", async (req) => {
    const recap = await services.heartbeat.generateDailyRecap(req.params.id);
    return { recap };
  });

  // ── Tasks ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>("/tasks", async (req) => {
    const list = await services.tasks.listTasks(req.query.projectId);
    return { tasks: list };
  });

  app.post<{ Body: unknown }>("/tasks", async (req) => {
    const input = CreateTaskRequestSchema.parse(req.body);
    assertNotPanic();

    await services.budgets.checkDailyBudget(input.projectId);
    const routingConfig = getProviderRoutingConfig(loadGlobalConfig());

    const providerId = await resolveTaskProviderId({
      requestedProviderId: input.providerId,
      projectId: input.projectId,
      globalDefaultProviderId: routingConfig.globalDefaultProviderId,
      allowSingleProviderAutoRoute: routingConfig.allowSingleProviderAutoRoute,
      projects: services.projects,
      providers: services.providers,
    });

    const task = await services.tasks.createTask({
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.skillId !== undefined ? { skillId: input.skillId } : {}),
      title: input.title,
      prompt: input.prompt,
      providerId,
      createdBy: "dashboard",
      ...(input.budgetCents !== undefined ? { budgetCents: input.budgetCents } : {}),
    });

    // Run in background
    void services.tasks.runTask(task.id);

    return { task };
  });

  app.get<{ Params: { id: string } }>("/tasks/:id", async (req) => {
    const task = await services.tasks.getTask(req.params.id);
    if (!task) throw new Error(`Task not found: ${req.params.id}`);
    return { task };
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/events", async (req) => {
    const events = await services.tasks.getTaskEvents(req.params.id);
    return { events };
  });

  app.get<{ Params: { id: string } }>("/tasks/:id/approvals", async (req) => {
    const approvals = await services.approvals.listApprovalsForTask(req.params.id);
    return { approvals };
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", async (req) => {
    await services.tasks.cancelTask(req.params.id);
    return { ok: true };
  });

  // ── Task event streaming (SSE) ──────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/tasks/:id/stream", async (req, reply) => {
    void reply.header("Content-Type", "text/event-stream");
    void reply.header("Cache-Control", "no-cache");
    void reply.header("Connection", "keep-alive");
    void reply.header("X-Accel-Buffering", "no");

    const taskId = req.params.id;

    return new Promise<void>((resolve) => {
      const listener = (evtTaskId: string, event: unknown) => {
        if (evtTaskId !== taskId) return;
        void reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = services.tasks.onEvent(listener);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        unsubscribe();
        resolve();
      };

      req.raw.on("close", cleanup);
      req.raw.on("error", cleanup);
      reply.raw.on("close", cleanup);
      reply.raw.on("error", cleanup);
      reply.raw.on("finish", cleanup);
    });
  });

  // ── Approvals ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>("/approvals", async (req) => {
    const list = await services.approvals.getPendingApprovals(req.query.projectId);
    return { approvals: list };
  });

  app.get<{ Params: { id: string } }>("/approvals/:id", async (req) => {
    const approval = await services.approvals.getApproval(req.params.id);
    if (!approval) throw new Error(`Approval not found: ${req.params.id}`);
    return { approval };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/approvals/:id/resolve", async (req) => {
    const input = ResolveApprovalRequestSchema.parse(req.body);
    if (input.decision === "approved") {
      assertNotPanic();
    }
    const approval = await services.approvals.resolveApproval(
      req.params.id,
      input.decision,
      input.scope,
    );
    await services.tasks.handleRecoveredApprovalResolution(approval);
    return { approval };
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  app.post("/heartbeat/run", async () => {
    assertNotPanic();
    const summary = await services.heartbeat.run({ manual: true });
    return { ok: true, summary };
  });

  app.get<{ Querystring: { projectId?: string } }>("/observations", async (req) => {
    const list = await services.heartbeat.getObservations(req.query.projectId);
    return { observations: list };
  });

  // ── Providers ─────────────────────────────────────────────────────────────
  app.get("/providers", async () => {
    const configs = await services.providerConfigs.list();
    const providersById = new Map(services.providers.list().map((provider) => [provider.id, provider]));
    const list = configs.map((config) => ({
      id: config.id,
      name: config.name,
      type: config.type,
      enabled: config.enabled,
      config: sanitizeProviderConfig(config.type, config.config),
      capabilities: providersById.get(config.id)?.capabilities ?? null,
      costEnforcementMode: getProviderCostEnforcementMode(config.type, config.config, providersById.get(config.id)?.capabilities ?? null),
      budgetWarning: getProviderBudgetWarning(config.type, config.config, providersById.get(config.id)?.capabilities ?? null),
    }));
    return { providers: list };
  });

  app.post<{ Body: unknown }>("/providers", async (req) => {
    assertNotPanic();
    const input = ProviderConfigRequestSchema.parse(req.body);
    const provider = await services.providerConfigs.upsert({
      id: input.id,
      name: input.name,
      type: input.type,
      enabled: input.enabled,
      config: buildStoredProviderConfig(input),
    });
    return { provider };
  });

  app.post<{ Params: { id: string } }>("/providers/:id/validate", async (req) => {
    assertNotPanic();
    const provider = services.providers.get(req.params.id);
    const health = await provider.validateConfig();
    return { health };
  });

  // ── Budgets ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>("/budgets/daily-spend", async (req) => {
    const cents = await services.budgets.getDailySpendCents(req.query.projectId);
    return { dailySpendCents: cents };
  });

  // ── Memories ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scope?: "global" | "project"; projectId?: string; kind?: "preference" | "fact" | "decision" | "constraint" | "workflow" } }>("/memories", async (req) => {
    const list = await services.memories.list({
      ...(req.query.scope ? { scope: req.query.scope } : {}),
      ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
      ...(req.query.kind ? { kind: req.query.kind } : {}),
    });
    return { memories: list };
  });

  app.post<{ Body: unknown }>("/memories", async (req) => {
    assertNotPanic();
    const input = MemoryRequestSchema.parse(req.body);
    const memory = await services.memories.create(input);
    return { memory };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/memories/:id", async (req) => {
    assertNotPanic();
    const input = UpdateMemoryRequestSchema.parse(req.body);
    const memory = await services.memories.update(req.params.id, input);
    return { memory };
  });

  app.delete<{ Params: { id: string } }>("/memories/:id", async (req) => {
    assertNotPanic();
    await services.memories.delete(req.params.id);
    return { ok: true };
  });

  // ── Skills ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { scope?: "global" | "project"; projectId?: string } }>("/skills", async (req) => {
    const list = await services.skills.list({
      ...(req.query.scope ? { scope: req.query.scope } : {}),
      ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
    });
    return { skills: list };
  });

  app.get<{ Params: { id: string } }>("/skills/:id", async (req) => {
    const skill = await services.skills.get(req.params.id);
    if (!skill) {
      throw new Error(`Skill not found: ${req.params.id}`);
    }
    return { skill };
  });

  app.post<{ Body: unknown }>("/skills", async (req) => {
    assertNotPanic();
    const input = SkillRequestSchema.parse(req.body);
    const skill = await services.skills.create(input);
    return { skill };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/skills/:id", async (req) => {
    assertNotPanic();
    const input = UpdateSkillRequestSchema.parse(req.body);
    const skill = await services.skills.update(req.params.id, input);
    return { skill };
  });

  app.delete<{ Params: { id: string } }>("/skills/:id", async (req) => {
    assertNotPanic();
    await services.skills.delete(req.params.id);
    return { ok: true };
  });

  // ── Dashboard static assets ──────────────────────────────────────────────
  app.get("/assets/*", async (req, reply) => {
    const assetPath = typeof req.params === "object" && req.params !== null && "*" in req.params
      ? String((req.params as Record<string, unknown>)["*"])
      : "";
    const fullPath = path.join(dashboardDistDir, "assets", assetPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return reply.status(404).send({ error: `Asset not found: ${assetPath}` });
    }

    return reply.type(getContentType(fullPath)).send(fs.readFileSync(fullPath));
  });

  app.get("/", async (_req, reply) => {
    return serveDashboardIndex(reply, dashboardDistDir);
  });

  app.get("/*", async (req, reply) => {
    const requestedPath = typeof req.params === "object" && req.params !== null && "*" in req.params
      ? String((req.params as Record<string, unknown>)["*"])
      : "";

    if (requestedPath.includes(".")) {
      const fullPath = path.join(dashboardDistDir, requestedPath);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return reply.status(404).send({ error: `File not found: ${requestedPath}` });
      }
      return reply.type(getContentType(fullPath)).send(fs.readFileSync(fullPath));
    }

    return serveDashboardIndex(reply, dashboardDistDir);
  });

  return app;
}

function serveDashboardIndex(reply: { type: (contentType: string) => { send: (payload: string) => unknown }; status: (code: number) => { send: (payload: unknown) => unknown } }, dashboardDistDir: string) {
  const indexPath = path.join(dashboardDistDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return reply.status(503).send({
      error: "Dashboard assets not built. Run 'pnpm --filter @feather/dashboard build' or 'pnpm dev'.",
    });
  }

  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(indexPath, "utf8"));
}

type CheckState = "ok" | "failed" | "unknown";
type DiagnosticState = "pass" | "fail";

async function getStructuredHealth(services: ApiServices) {
  const locks = readGuardLocks();
  const panic = getPanicState();
  const checks: Record<string, CheckState> = {
    http: "ok",
    database: await checkDatabase(),
    providerRegistry: await checkProviderRegistry(services),
    taskRunner: checkTaskRunner(services),
    telegram: "unknown",
    toolRegistry: checkToolRegistry(),
    memory: await checkMemory(services),
    skills: await checkSkills(services),
    logs: checkLogsWritable(),
  };

  const coreFailed = ["database", "providerRegistry", "taskRunner", "toolRegistry", "memory", "logs"]
    .some((key) => checks[key] === "failed");
  const optionalFailed = Object.values(checks).some((check) => check === "failed");
  const lastSuccessfulTaskAt = await getLastSuccessfulTaskAt();

  const status = (() => {
    if (locks["safe-mode.lock"].active) return "safe_mode";
    if (locks["maintenance.lock"].active || locks["update.lock"].active) return "maintenance";
    if (panic.active || coreFailed) return "critical";
    if (optionalFailed) return "degraded";
    return "healthy";
  })();

  return {
    ok: status === "healthy",
    status,
    version: "0.1.0-alpha",
    bootId: process.env["FEATHER_BOOT_ID"] ?? `pid_${process.pid}`,
    uptimeMs: Math.round(process.uptime() * 1000),
    checks,
    recentFatalErrors: [],
    lastSuccessfulTaskAt,
    lastUpdateAt: null,
    panicLockActive: locks["panic.lock"].active,
    maintenanceMode: locks["maintenance.lock"].active,
    locks,
    panic,
    taskRunner: {
      activeTasks: services.tasks.getActiveTaskCount(),
      listeners: services.tasks.getListenerCount(),
    },
  };
}

async function runNoopDiagnostic(services: ApiServices) {
  const checks: Record<string, DiagnosticState> = {
    http: "pass",
    toolRegistry: checkToolRegistry() === "ok" ? "pass" : "fail",
    providerRegistry: await checkProviderRegistry(services) === "ok" ? "pass" : "fail",
    taskQueue: checkTaskRunner(services) === "ok" ? "pass" : "fail",
    dbRead: await checkDatabase() === "ok" ? "pass" : "fail",
    dbWriteTemp: await checkTemporaryDbWrite() ? "pass" : "fail",
    memoryRead: await checkMemory(services) === "ok" ? "pass" : "fail",
    logsWritable: checkLogsWritable() === "ok" ? "pass" : "fail",
    panicRespected: getPanicState().active ? "pass" : "pass",
  };
  const result = Object.values(checks).every((check) => check === "pass") ? "pass" : "fail";
  return {
    diagnosticId: `diag_${Date.now()}`,
    result,
    checks,
  };
}

async function checkDatabase(): Promise<CheckState> {
  try {
    await getDb().select({ count: sql<number>`count(*)` }).from(tasks);
    return "ok";
  } catch {
    return "failed";
  }
}

async function checkTemporaryDbWrite(): Promise<boolean> {
  try {
    await getDb().run(sql`CREATE TEMP TABLE IF NOT EXISTS feather_guard_noop (id TEXT PRIMARY KEY)`);
    await getDb().run(sql`INSERT OR REPLACE INTO feather_guard_noop (id) VALUES ('noop')`);
    return true;
  } catch {
    return false;
  }
}

async function checkProviderRegistry(services: ApiServices): Promise<CheckState> {
  try {
    services.providers.list();
    await services.providerConfigs.list();
    return "ok";
  } catch {
    return "failed";
  }
}

function checkTaskRunner(services: ApiServices): CheckState {
  try {
    services.tasks.getActiveTaskCount();
    services.tasks.getListenerCount();
    return "ok";
  } catch {
    return "failed";
  }
}

function checkToolRegistry(): CheckState {
  return FEATHER_TOOL_NAMES.length > 0 ? "ok" : "failed";
}

async function checkMemory(services: ApiServices): Promise<CheckState> {
  try {
    await services.memories.list({ scope: "global" });
    return "ok";
  } catch {
    return "failed";
  }
}

async function checkSkills(services: ApiServices): Promise<CheckState> {
  try {
    await services.skills.list({ scope: "global" });
    return "ok";
  } catch {
    return "failed";
  }
}

function checkLogsWritable(): CheckState {
  try {
    const logsDir = path.join(getFeatherHomeDir(), "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "gateway.healthcheck.log"), `${new Date().toISOString()} health\n`, "utf8");
    return "ok";
  } catch {
    return "failed";
  }
}

async function getLastSuccessfulTaskAt(): Promise<string | null> {
  try {
    const rows = await getDb()
      .select({ completedAt: sql<string | null>`max(updated_at)` })
      .from(tasks)
      .where(sql`status = 'completed'`);
    return rows[0]?.completedAt ?? null;
  } catch {
    return null;
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function getOnboardingState(services: ApiServices) {
  const globalConfig = loadGlobalConfig();
  const providers = (await services.providerConfigs.list()).filter((provider) => provider.enabled);
  const projects = await services.projects.listProjects();
  const globalAgent = loadGlobalAgentInstructions();

  return deriveOnboardingState({
    providerCount: providers.length,
    projectCount: projects.length,
    telegramConfigured: hasTelegramConfig(globalConfig),
    telegramStepCompleted: globalConfig.onboarding?.telegramStepCompleted === true,
    machineSetupCompletedFlag: globalConfig.onboarding?.machineSetupCompleted === true,
    hasGlobalAgent: Boolean(globalAgent?.trim()),
    agentSetupCompletedFlag: globalConfig.onboarding?.agentSetupCompleted === true,
    featherHomeDir: getFeatherHomeDir(),
    globalConfigPath: getGlobalConfigPath(),
    globalAgentFilePath: getGlobalAgentFilePath(),
    agentName: extractAgentName(globalAgent),
  });
}

function hasTelegramConfig(globalConfig: { telegramBotToken?: string; allowedTelegramUserIds?: number[] }): boolean {
  const token = process.env["TELEGRAM_BOT_TOKEN"] ?? globalConfig.telegramBotToken;
  const envAllowed = process.env["TELEGRAM_ALLOWED_USER_IDS"];
  const allowedUserIds = envAllowed
    ? envAllowed.split(",").map((entry) => Number.parseInt(entry.trim(), 10)).filter((value) => !Number.isNaN(value))
    : globalConfig.allowedTelegramUserIds ?? [];

  return Boolean(token && allowedUserIds.length > 0);
}

function sanitizeProviderConfig(
  type: ProviderConfigType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    case "codex-cli":
      return {
        ...(typeof config.command === "string" ? { command: config.command } : {}),
        ...(config.mode === "apply" || config.mode === "exec" ? { mode: config.mode } : {}),
      };
    case "openai":
      return {
        ...(config.credentialMode === "env" || config.credentialMode === "local" ? { credentialMode: config.credentialMode } : {}),
        ...(typeof config.apiKeyEnv === "string" ? { apiKeyEnv: config.apiKeyEnv } : {}),
        ...(config.credentialMode === "local" ? { apiKeyStoredLocally: true } : {}),
        ...(typeof config.model === "string" ? { model: config.model } : {}),
        ...(typeof config.maxTaskCents === "number" ? { maxTaskCents: config.maxTaskCents } : {}),
        ...(typeof config.baseUrl === "string" ? { baseUrl: config.baseUrl } : {}),
        ...(typeof config.inputCentsPer1MTokens === "number" ? { inputCentsPer1MTokens: config.inputCentsPer1MTokens } : {}),
        ...(typeof config.outputCentsPer1MTokens === "number" ? { outputCentsPer1MTokens: config.outputCentsPer1MTokens } : {}),
      };
    case "openai-compatible":
      return {
        ...(typeof config.baseUrl === "string" ? { baseUrl: config.baseUrl } : {}),
        ...(config.credentialMode === "env" || config.credentialMode === "local" ? { credentialMode: config.credentialMode } : {}),
        ...(typeof config.apiKeyEnv === "string" ? { apiKeyEnv: config.apiKeyEnv } : {}),
        ...(config.credentialMode === "local" ? { apiKeyStoredLocally: true } : {}),
        ...(typeof config.model === "string" ? { model: config.model } : {}),
        ...(typeof config.maxTaskCents === "number" ? { maxTaskCents: config.maxTaskCents } : {}),
        ...(typeof config.inputCentsPer1MTokens === "number" ? { inputCentsPer1MTokens: config.inputCentsPer1MTokens } : {}),
        ...(typeof config.outputCentsPer1MTokens === "number" ? { outputCentsPer1MTokens: config.outputCentsPer1MTokens } : {}),
      };
    case "openrouter":
      return {
        ...(config.credentialMode === "env" || config.credentialMode === "local" ? { credentialMode: config.credentialMode } : {}),
        ...(typeof config.apiKeyEnv === "string" ? { apiKeyEnv: config.apiKeyEnv } : {}),
        ...(config.credentialMode === "local" ? { apiKeyStoredLocally: true } : {}),
        ...(typeof config.model === "string" ? { model: config.model } : {}),
        ...(typeof config.maxTaskCents === "number" ? { maxTaskCents: config.maxTaskCents } : {}),
        ...(typeof config.inputCentsPer1MTokens === "number" ? { inputCentsPer1MTokens: config.inputCentsPer1MTokens } : {}),
        ...(typeof config.outputCentsPer1MTokens === "number" ? { outputCentsPer1MTokens: config.outputCentsPer1MTokens } : {}),
      };
    default:
      return {};
  }
}

function getProviderCostEnforcementMode(
  type: ProviderConfigType,
  config: Record<string, unknown>,
  capabilities: { costEnforcementMode?: "known" | "estimated" | "unknown" } | null,
): "known" | "estimated" | "unknown" {
  if (capabilities?.costEnforcementMode) {
    return capabilities.costEnforcementMode;
  }

  if (type === "codex-cli") {
    return "unknown";
  }

  return typeof config.inputCentsPer1MTokens === "number" && typeof config.outputCentsPer1MTokens === "number"
    ? "estimated"
    : "unknown";
}

function getProviderBudgetWarning(
  type: ProviderConfigType,
  config: Record<string, unknown>,
  capabilities: { costEnforcementMode?: "known" | "estimated" | "unknown" } | null,
): string {
  const mode = getProviderCostEnforcementMode(type, config, capabilities);
  if (mode === "known") {
    return "Provider returns cost data directly.";
  }
  if (mode === "estimated") {
    return "Pricing configured. Feather can estimate task spend.";
  }
  return "No pricing configured. Feather can record token usage but cannot enforce hard spend caps.";
}

function buildStoredProviderConfig(input: ProviderConfigRequest): Record<string, unknown> {
  switch (input.type) {
    case "codex-cli":
      return { command: input.command, mode: input.mode };
    case "openai": {
      const credentials = resolveApiProviderCredentials(input);
      return {
        ...credentials,
        model: input.model,
        maxTaskCents: input.maxTaskCents,
        baseUrl: input.baseUrl,
        inputCentsPer1MTokens: input.inputCentsPer1MTokens,
        outputCentsPer1MTokens: input.outputCentsPer1MTokens,
      };
    }
    case "openai-compatible": {
      const credentials = resolveApiProviderCredentials(input);
      return {
        baseUrl: input.baseUrl,
        ...credentials,
        model: input.model,
        maxTaskCents: input.maxTaskCents,
        inputCentsPer1MTokens: input.inputCentsPer1MTokens,
        outputCentsPer1MTokens: input.outputCentsPer1MTokens,
      };
    }
    case "openrouter": {
      const credentials = resolveApiProviderCredentials(input);
      return {
        ...credentials,
        model: input.model,
        maxTaskCents: input.maxTaskCents,
        inputCentsPer1MTokens: input.inputCentsPer1MTokens,
        outputCentsPer1MTokens: input.outputCentsPer1MTokens,
      };
    }
  }
}

function resolveApiProviderCredentials(
  input: Extract<ProviderConfigRequest, { type: "openai" | "openai-compatible" | "openrouter" }>,
): { apiKeyEnv: string; credentialMode: "env" | "local" } {
  const credentialMode = input.credentialMode ?? "env";
  if (credentialMode === "local") {
    const apiKeyEnv = input.apiKeyEnv?.trim() || deriveProviderLocalApiKeyEnvName(input.type, input.id);
    const apiKeyValue = input.apiKeyValue?.trim();
    if (!apiKeyValue) {
      if (process.env[apiKeyEnv]) {
        return { apiKeyEnv, credentialMode };
      }
      throw new ValidationError("Paste an API key or switch this provider to environment variable mode.");
    }

    upsertFeatherLocalSecret(apiKeyEnv, apiKeyValue);
    return { apiKeyEnv, credentialMode };
  }

  const apiKeyEnv = input.apiKeyEnv?.trim();
  if (!apiKeyEnv) {
    throw new ValidationError("Enter the environment variable name that holds this provider API key.");
  }

  return { apiKeyEnv, credentialMode };
}
