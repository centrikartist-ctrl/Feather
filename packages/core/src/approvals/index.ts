import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { approvals } from "../db/schema.js";
import type { Approval, RiskLevel } from "@feather/shared";
import { ApprovalRequiredError } from "@feather/shared";
import { assertNotPanic } from "../panic/index.js";

type ApprovalRow = {
  id: string;
  taskId: string | null;
  projectId: string | null;
  title: string;
  reason: string;
  actionType: string;
  risk: string;
  payloadJson: string;
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
  approvedScope?: string | null;
};

function rowToApproval(row: ApprovalRow): Approval {
  const base: Approval = {
    id: row.id,
    title: row.title,
    reason: row.reason,
    actionType: row.actionType as Approval["actionType"],
    risk: row.risk as RiskLevel,
    payload: JSON.parse(row.payloadJson) as unknown,
    status: row.status as Approval["status"],
    createdAt: row.createdAt,
  };
  if (row.taskId !== null && row.taskId !== undefined) base.taskId = row.taskId;
  if (row.projectId !== null && row.projectId !== undefined) base.projectId = row.projectId;
  if (row.resolvedAt) base.resolvedAt = row.resolvedAt;
  if (row.approvedScope) base.approvedScope = row.approvedScope as Approval["approvedScope"];
  return base;
}

export type CreateApprovalInput = {
  taskId?: string;
  projectId?: string;
  title: string;
  reason: string;
  actionType: Approval["actionType"];
  risk: RiskLevel;
  payload: unknown;
};

export class ApprovalService {
  private resolutionWaiters = new Map<string, Set<{ resolve: (approval: Approval) => void; reject: (error: Error) => void }>>();

  async createApproval(input: CreateApprovalInput): Promise<Approval> {
    const id = nanoid();
    const now = new Date().toISOString();
    const db = getDb();

    await db.insert(approvals).values({
      id,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      title: input.title,
      reason: input.reason,
      actionType: input.actionType,
      risk: input.risk,
      payloadJson: JSON.stringify(input.payload),
      status: "pending",
      createdAt: now,
    });

    return {
      id,
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      title: input.title,
      reason: input.reason,
      actionType: input.actionType,
      risk: input.risk,
      payload: input.payload,
      status: "pending" as const,
      createdAt: now,
    };
  }

  async requireApproval(input: CreateApprovalInput): Promise<never> {
    const approval = await this.createApproval(input);
    throw new ApprovalRequiredError(approval.id, input.title);
  }

  async resolveApproval(
    id: string,
    decision: "approved" | "rejected",
    scope?: "once" | "project" | "global_pattern",
  ): Promise<Approval> {
    if (decision === "approved") {
      assertNotPanic();
    }

    const db = getDb();
    const now = new Date().toISOString();

    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error(`Approval not found: ${id}`);
    }

    if (row.status !== "pending") {
      throw new Error(`Approval ${id} is already ${row.status}`);
    }

    await db
      .update(approvals)
      .set({ status: decision, resolvedAt: now, approvedScope: scope ?? null })
      .where(eq(approvals.id, id));

    const resolvedApproval: Approval = {
      id: row.id,
      ...(row.taskId !== null ? { taskId: row.taskId } : {}),
      ...(row.projectId !== null ? { projectId: row.projectId } : {}),
      title: row.title,
      reason: row.reason,
      actionType: row.actionType as Approval["actionType"],
      risk: row.risk as RiskLevel,
      payload: JSON.parse(row.payloadJson) as unknown,
      status: decision,
      createdAt: row.createdAt,
      resolvedAt: now,
      ...(scope !== undefined ? { approvedScope: scope } : {}),
    };

    this.notifyResolution(id, resolvedApproval);
    return resolvedApproval;
  }

  async waitForResolution(id: string, signal?: AbortSignal): Promise<Approval> {
    const existing = await this.getApproval(id);
    if (!existing) {
      throw new Error(`Approval not found: ${id}`);
    }
    if (existing.status !== "pending") {
      return existing;
    }

    return new Promise<Approval>((resolve, reject) => {
      let waiter: { resolve: (approval: Approval) => void; reject: (error: Error) => void };

      const onAbort = () => {
        cleanup();
        reject(new Error(`Approval wait aborted: ${id}`));
      };

      const cleanup = () => {
        const waiters = this.resolutionWaiters.get(id);
        if (waiters) {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            this.resolutionWaiters.delete(id);
          }
        }
        signal?.removeEventListener("abort", onAbort);
      };

      waiter = {
        resolve: (approval: Approval) => {
          cleanup();
          resolve(approval);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      };

      const waiters = this.resolutionWaiters.get(id) ?? new Set<typeof waiter>();
      waiters.add(waiter);
      this.resolutionWaiters.set(id, waiters);

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async getPendingApprovals(projectId?: string): Promise<Approval[]> {
    const db = getDb();

    const rows = projectId
      ? await db
          .select()
          .from(approvals)
          .where(and(eq(approvals.status, "pending"), eq(approvals.projectId, projectId)))
      : await db.select().from(approvals).where(eq(approvals.status, "pending"));

    return rows.map(rowToApproval);
  }

  async getApproval(id: string): Promise<Approval | null> {
    const db = getDb();
    const rows = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToApproval(row);
  }

  async expireOldApprovals(olderThanHours = 24): Promise<number> {
    const db = getDb();
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    const result = await db
      .update(approvals)
      .set({ status: "expired" })
      .where(and(eq(approvals.status, "pending"), eq(approvals.createdAt, cutoff)));

    return 0; // Drizzle doesn't easily return count for sqlite updates
  }

  private notifyResolution(id: string, approval: Approval): void {
    const waiters = this.resolutionWaiters.get(id);
    if (!waiters) return;

    for (const waiter of waiters) {
      waiter.resolve(approval);
    }
    this.resolutionWaiters.delete(id);
  }
}
