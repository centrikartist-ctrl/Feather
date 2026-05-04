import { nanoid } from "nanoid";
import { eq, and, gte } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { budgets, costEvents } from "../db/schema.js";
import { BudgetExceededError } from "@feather/shared";

export type RecordCostInput = {
  taskId?: string;
  projectId?: string;
  providerId: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCents?: number;
};

export class BudgetService {
  async recordCost(input: RecordCostInput): Promise<void> {
    const db = getDb();
    await db.insert(costEvents).values({
      id: nanoid(),
      taskId: input.taskId,
      projectId: input.projectId,
      providerId: input.providerId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCents: input.estimatedCents,
      createdAt: new Date().toISOString(),
    });
  }

  async getDailySpendCents(projectId?: string): Promise<number> {
    const db = getDb();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStartIso = dayStart.toISOString();

    const rows = projectId
      ? await db
          .select({ estimatedCents: costEvents.estimatedCents })
          .from(costEvents)
          .where(
            and(
              eq(costEvents.projectId, projectId),
              gte(costEvents.createdAt, dayStartIso),
            ),
          )
      : await db
          .select({ estimatedCents: costEvents.estimatedCents })
          .from(costEvents)
          .where(gte(costEvents.createdAt, dayStartIso));

    return rows.reduce((sum, r) => sum + (r.estimatedCents ?? 0), 0);
  }

  async checkDailyBudget(projectId?: string): Promise<void> {
    const db = getDb();
    const rows = await db
      .select()
      .from(budgets)
      .where(eq(budgets.scope, projectId ? "project" : "global"))
      .limit(1);

    const budget = rows[0];
    if (!budget?.dailyLimitCents) return;

    const spent = await this.getDailySpendCents(projectId);
    if (spent >= budget.dailyLimitCents) {
      throw new BudgetExceededError(
        projectId ? `project:${projectId}` : "global",
        budget.dailyLimitCents,
      );
    }
  }

  async checkTaskBudget(projectId?: string, estimatedCents?: number): Promise<void> {
    if (!estimatedCents) return;

    const db = getDb();
    const rows = await db
      .select()
      .from(budgets)
      .where(eq(budgets.scope, projectId ? "project" : "global"))
      .limit(1);

    const budget = rows[0];
    if (!budget?.taskLimitCents) return;

    if (estimatedCents > budget.taskLimitCents) {
      throw new BudgetExceededError(
        `task budget (${projectId ? `project:${projectId}` : "global"})`,
        budget.taskLimitCents,
      );
    }
  }

  async getTaskHardLimitCents(projectId?: string, taskBudgetCents?: number): Promise<number | undefined> {
    const db = getDb();
    const rows = await db
      .select({ taskLimitCents: budgets.taskLimitCents })
      .from(budgets)
      .where(eq(budgets.scope, projectId ? "project" : "global"))
      .limit(1);

    const configuredLimit = rows[0]?.taskLimitCents ?? undefined;
    if (taskBudgetCents === undefined) return configuredLimit;
    if (configuredLimit === undefined) return taskBudgetCents;
    return Math.min(taskBudgetCents, configuredLimit);
  }

  /**
   * Return the total estimated spend (in cents) recorded for a given task.
   * Events without estimatedCents contribute 0 (pricing unknown for that event).
   */
  async getTaskSpendCents(taskId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ estimatedCents: costEvents.estimatedCents })
      .from(costEvents)
      .where(eq(costEvents.taskId, taskId));
    return rows.reduce((sum, r) => sum + (r.estimatedCents ?? 0), 0);
  }
}
