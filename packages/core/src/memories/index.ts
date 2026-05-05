import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import type { Memory, MemoryKind, MemoryScope } from "@feather/shared";
import { getDb } from "../db/index.js";
import { memories } from "../db/schema.js";

export type CreateMemoryInput = {
  scope: MemoryScope;
  projectId?: string;
  kind: MemoryKind;
  content: string;
  sourceTaskId?: string;
};

export type UpdateMemoryInput = Partial<Pick<CreateMemoryInput, "kind" | "content" | "projectId">>;

export class MemoryService {
  async list(filters: { scope?: MemoryScope; projectId?: string; kind?: MemoryKind } = {}): Promise<Memory[]> {
    const db = getDb();
    const rows = await db.select().from(memories).orderBy(desc(memories.updatedAt));
    return rows
      .map(rowToMemory)
      .filter((memory) => {
        if (filters.scope && memory.scope !== filters.scope) return false;
        if (filters.projectId && memory.projectId !== filters.projectId) return false;
        if (filters.kind && memory.kind !== filters.kind) return false;
        return true;
      });
  }

  async get(id: string): Promise<Memory | null> {
    const db = getDb();
    const rows = await db.select().from(memories).where(eq(memories.id, id)).limit(1);
    const row = rows[0];
    return row ? rowToMemory(row) : null;
  }

  async create(input: CreateMemoryInput): Promise<Memory> {
    validateMemoryInput(input);
    const id = nanoid();
    const now = new Date().toISOString();
    const db = getDb();
    await db.insert(memories).values({
      id,
      scope: input.scope,
      projectId: input.scope === "project" ? input.projectId ?? null : null,
      kind: input.kind,
      content: input.content.trim(),
      sourceTaskId: input.sourceTaskId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      scope: input.scope,
      ...(input.scope === "project" ? { projectId: input.projectId } : {}),
      kind: input.kind,
      content: input.content.trim(),
      ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }
    const next: CreateMemoryInput = {
      scope: existing.scope,
      projectId: existing.scope === "project" ? (input.projectId ?? existing.projectId) : undefined,
      kind: input.kind ?? existing.kind,
      content: input.content ?? existing.content,
      sourceTaskId: existing.sourceTaskId,
    };
    validateMemoryInput(next);
    const updatedAt = new Date().toISOString();
    const db = getDb();
    await db.update(memories).set({
      projectId: next.scope === "project" ? next.projectId ?? null : null,
      kind: next.kind,
      content: next.content.trim(),
      updatedAt,
    }).where(eq(memories.id, id));
    const updated = await this.get(id);
    if (!updated) {
      throw new Error(`Memory not found after update: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(memories).where(eq(memories.id, id));
  }

  async getPromptMemories(projectId?: string): Promise<{ global: Memory[]; project: Memory[] }> {
    const global = (await this.list({ scope: "global" })).slice(0, 10);
    const project = projectId ? (await this.list({ scope: "project", projectId })).slice(0, 10) : [];
    return { global, project };
  }
}

function validateMemoryInput(input: CreateMemoryInput): void {
  if (!input.content.trim()) {
    throw new Error("Memory content cannot be empty.");
  }
  if (input.scope === "project" && !input.projectId) {
    throw new Error("Project memories require a projectId.");
  }
}

function rowToMemory(row: typeof memories.$inferSelect): Memory {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    kind: row.kind as MemoryKind,
    content: row.content,
    ...(row.sourceTaskId ? { sourceTaskId: row.sourceTaskId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}