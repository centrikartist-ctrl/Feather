import { nanoid } from "nanoid";
import { and, eq, gte, lt, isNotNull } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { heartbeatRuns, observations } from "../db/schema.js";
import type { Observation, SuggestedAction } from "@feather/shared";
import type { ProjectService } from "../projects/index.js";
import type { ApprovalService } from "../approvals/index.js";
import { gitStatus } from "../tools/git.js";
import { loadGlobalConfig, loadProjectFileConfig, resolveHeartbeatConfig } from "../config/index.js";
import { getPanicState } from "../panic/index.js";
import type { MemoryService } from "../memories/index.js";

export type HeartbeatCheckResult = {
  observations: Omit<Observation, "id" | "createdAt">[];
};

type HeartbeatObservation = Omit<Observation, "id" | "createdAt"> & {
  /** Stable key for deduplication: "<projectId>:<checkId>" */
  dedupeKey?: string;
};

const OBSERVATION_RETENTION_DAYS = 7;
const OBSERVATION_DEDUPE_WINDOW_HOURS = 6;
const PROJECT_CHECK_TIMEOUT_MS = 10000;
const HEARTBEAT_CONCURRENCY = 2;

export class HeartbeatService {
  private isRunning = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly projects: ProjectService,
    private readonly approvals: ApprovalService,
    private readonly memories?: MemoryService,
  ) {}

  start(intervalMinutes: number = loadGlobalConfig().heartbeat?.intervalMinutes ?? 30): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(
      () => void this.run(),
      intervalMinutes * 60 * 1000,
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async run(options: { manual?: boolean } = {}): Promise<string> {
    if (getPanicState().active) return "Skipped: panic mode is active.";
    if (this.isRunning) return "Already running";
    this.isRunning = true;

    const runId = nanoid();
    const startedAt = new Date().toISOString();
    const db = getDb();

    await db.insert(heartbeatRuns).values({
      id: runId,
      startedAt,
      status: "running",
    });

    await this.pruneOldObservations();

    const collectedObservations: Omit<Observation, "id" | "createdAt">[] = [];
    let scannedProjects = 0;

    try {
      const projectList = await this.projects.listProjects();

      // Filter projects that should run, then process with concurrency limit.
      const projectsToCheck = projectList.filter((project) => {
        const config = loadProjectFileConfig(project.rootPath);
        return this.shouldRunProject(project, config, options.manual === true);
      });

      await runWithConcurrencyLimit(projectsToCheck, HEARTBEAT_CONCURRENCY, async (project) => {
        scannedProjects += 1;
        const config = loadProjectFileConfig(project.rootPath);
        try {
          const projectObservations = await withTimeout(
            this.collectProjectObservations(project, config),
            PROJECT_CHECK_TIMEOUT_MS,
            `Heartbeat checks timed out for ${project.name}`,
          );
          collectedObservations.push(...projectObservations);
        } catch (err) {
          collectedObservations.push({
            projectId: project.id,
            source: "heartbeat",
            severity: "warning",
            title: `Heartbeat check failed for ${project.name}`,
            body: err instanceof Error ? err.message : String(err),
            suggestedActions: [],
          });
        }
      });

      let persistedCount = 0;
      const now = new Date().toISOString();
      for (const obs of collectedObservations as HeartbeatObservation[]) {
        if (obs.dedupeKey) {
          const existing = await db
            .select()
            .from(observations)
            .where(eq(observations.dedupeKey, obs.dedupeKey))
            .limit(1);
          if (existing.length > 0 && existing[0]) {
            // Update the existing observation (seen again).
            await db
              .update(observations)
              .set({
                lastSeenAt: now,
                seenCount: (existing[0].seenCount ?? 1) + 1,
                body: obs.body,
                severity: obs.severity,
              })
              .where(eq(observations.id, existing[0].id));
            continue;
          }
        } else if (await this.isDuplicateObservation(obs)) {
          continue;
        }

        await db.insert(observations).values({
          id: nanoid(),
          projectId: obs.projectId,
          source: obs.source,
          severity: obs.severity,
          title: obs.title,
          body: obs.body,
          suggestedActionsJson: JSON.stringify(obs.suggestedActions),
          createdAt: now,
          dedupeKey: obs.dedupeKey ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          seenCount: 1,
        });
        persistedCount += 1;
      }

      const summary = `Heartbeat complete. ${persistedCount} new observation(s) across ${scannedProjects} project(s).`;

      await db
        .update(heartbeatRuns)
        .set({ completedAt: new Date().toISOString(), status: "completed", summary })
        .where(eq(heartbeatRuns.id, runId));

      return summary;
    } catch (err) {
      await db
        .update(heartbeatRuns)
        .set({ completedAt: new Date().toISOString(), status: "failed", summary: String(err) })
        .where(eq(heartbeatRuns.id, runId));
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  async getObservations(projectId?: string): Promise<Observation[]> {
    const db = getDb();
    const rows = projectId
      ? await db.select().from(observations).where(eq(observations.projectId, projectId))
      : await db.select().from(observations);

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId ?? undefined,
      source: row.source as Observation["source"],
      severity: row.severity as Observation["severity"],
      title: row.title,
      body: row.body,
      suggestedActions: JSON.parse(row.suggestedActionsJson) as SuggestedAction[],
      createdAt: row.createdAt,
    }));
  }

  async generateDailyRecap(projectId: string): Promise<string> {
    const project = await this.projects.getProject(projectId);
    const obs = await this.getObservations(projectId);
    const heartbeatConfig = resolveHeartbeatConfig(loadProjectFileConfig(project.rootPath));
    const promptMemories = await this.memories?.getPromptMemories(projectId);

    const gitResult = await gitStatus({ projectRoot: project.rootPath });

    const lines: string[] = [
      `# Daily Recap: ${project.name}`,
      `Generated: ${new Date().toLocaleString()}`,
      "",
    ];

    if (gitResult.ok && typeof gitResult.output === "string") {
      lines.push("## Git Status", "```", gitResult.output, "```", "");
    }

    if (heartbeatConfig.instructions.length > 0) {
      lines.push("## Heartbeat Instructions", ...heartbeatConfig.instructions.map((instruction) => `- ${instruction}`), "");
    }

    if (promptMemories && (promptMemories.global.length > 0 || promptMemories.project.length > 0)) {
      lines.push("## Memory Context");
      for (const memory of [...promptMemories.global, ...promptMemories.project]) {
        lines.push(`- [${memory.kind}] ${memory.content}`);
      }
      lines.push("");
    }

    if (obs.length > 0) {
      lines.push("## Observations");
      for (const o of obs.slice(-10)) {
        lines.push(`- [${o.severity.toUpperCase()}] ${o.title}`);
        if (o.suggestedActions.length > 0) {
          for (const action of o.suggestedActions) {
            lines.push(`  → ${action.label}`);
          }
        }
      }
    } else {
      lines.push("No observations recorded.");
    }

    return lines.join("\n");
  }

  private shouldRunProject(
    project: Awaited<ReturnType<ProjectService["getProject"]>>,
    config: ReturnType<typeof loadProjectFileConfig>,
    manual: boolean,
  ): boolean {
    const heartbeatConfig = resolveHeartbeatConfig(config);
    if (!project.heartbeatEnabled) return false;
    if (heartbeatConfig.enabled === false) return false;
    if (heartbeatConfig.mode === "off") return false;
    if (!manual && heartbeatConfig.mode === "manual") return false;
    if (!manual && heartbeatConfig.quietHours && isWithinQuietHours(heartbeatConfig.quietHours.start, heartbeatConfig.quietHours.end)) {
      return false;
    }
    return true;
  }

  private async collectProjectObservations(
    project: Awaited<ReturnType<ProjectService["getProject"]>>,
    config: ReturnType<typeof loadProjectFileConfig>,
  ): Promise<HeartbeatObservation[]> {
    const collected: HeartbeatObservation[] = [];
    const heartbeatConfig = resolveHeartbeatConfig(config);
    const includeSuggestions = heartbeatConfig.mode === "proactive";

    if (heartbeatConfig.checks.gitDirty.enabled && !(await this.isCheckOnCooldown(project.id, "git_dirty", heartbeatConfig.checks.gitDirty.cooldownMinutes))) {
      const gitResult = await gitStatus({ projectRoot: project.rootPath });
      if (gitResult.ok && typeof gitResult.output === "string" && gitResult.output.trim()) {
        const lines = gitResult.output.split("\n").filter((line) => !line.startsWith("##"));
        if (lines.length > 0) {
          collected.push({
            projectId: project.id,
            source: "heartbeat",
            severity: "suggestion",
            title: `${project.name} has uncommitted changes`,
            body: `${lines.length} file(s) changed:\n${lines.slice(0, 10).join("\n")}`,
            suggestedActions: includeSuggestions ? [
              {
                id: nanoid(),
                label: "Summarise changes",
                prompt: `Summarise the uncommitted changes in ${project.name} and suggest the next step.`,
                requiresApproval: false,
              },
            ] : [],
            dedupeKey: `${project.id}:git_dirty`,
          });
        }
      }
    }

    if (heartbeatConfig.checks.pendingApprovals.enabled && !(await this.isCheckOnCooldown(project.id, "pending_approvals", heartbeatConfig.checks.pendingApprovals.cooldownMinutes))) {
      const pending = await this.approvals.getPendingApprovals(project.id);
      if (pending.length > 0) {
        collected.push({
          projectId: project.id,
          source: "heartbeat",
          severity: "warning",
          title: `${project.name} has ${pending.length} pending approval(s)`,
          body: pending.map((approval) => `• ${approval.title} (${approval.risk})`).join("\n"),
          suggestedActions: includeSuggestions ? [
            {
              id: nanoid(),
              label: "Review approvals",
              prompt: `Review the pending approvals for ${project.name} and explain what needs a decision.`,
              requiresApproval: false,
            },
          ] : [],
          dedupeKey: `${project.id}:pending_approvals`,
        });
      }
    }

    return collected;
  }

  private async isDuplicateObservation(obs: Omit<Observation, "id" | "createdAt">): Promise<boolean> {
    const db = getDb();
    const cutoff = new Date(Date.now() - OBSERVATION_DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const rows = await db
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.source, obs.source),
          eq(observations.title, obs.title),
          eq(observations.body, obs.body),
          gte(observations.createdAt, cutoff),
        ),
      );

    return rows.some((row) => (row.projectId ?? undefined) === obs.projectId);
  }

  private async pruneOldObservations(): Promise<void> {
    const db = getDb();
    const cutoff = new Date(Date.now() - OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.delete(observations).where(lt(observations.createdAt, cutoff));
  }

  private async isCheckOnCooldown(projectId: string, checkId: string, cooldownMinutes: number): Promise<boolean> {
    if (cooldownMinutes <= 0) {
      return false;
    }
    const db = getDb();
    const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();
    const rows = await db.select().from(observations).where(and(eq(observations.dedupeKey, `${projectId}:${checkId}`), gte(observations.lastSeenAt, cutoff)));
    return rows.length > 0;
  }
}

function isWithinQuietHours(start: string, end: string, now = new Date()): boolean {
  const [startHour, startMinute] = parseClockTime(start);
  const [endHour, endMinute] = parseClockTime(end);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function parseClockTime(value: string): [number, number] {
  const parts = value.split(":");
  const hour = Number.parseInt(parts[0] ?? "0", 10);
  const minute = Number.parseInt(parts[1] ?? "0", 10);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  // Process items in batches of `limit` in parallel.
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    await Promise.all(batch.map(fn));
  }
}