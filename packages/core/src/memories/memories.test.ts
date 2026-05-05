import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { MemoryService } from "./index.js";

let memoryService: MemoryService;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `feather-memories-${Date.now()}-${Math.random()}.db`);
  initDb(dbPath);
  memoryService = new MemoryService();
});

afterEach(() => {
  closeDb();
});

describe("MemoryService", () => {
  it("creates global and project memories and filters them", async () => {
    const globalMemory = await memoryService.create({
      scope: "global",
      kind: "preference",
      content: "Keep summaries short.",
    });
    const projectMemory = await memoryService.create({
      scope: "project",
      projectId: "project-1",
      kind: "constraint",
      content: "Do not add features.",
    });

    expect(globalMemory.scope).toBe("global");
    expect(projectMemory.projectId).toBe("project-1");
    expect((await memoryService.list({ scope: "global" }))).toHaveLength(1);
    expect((await memoryService.list({ scope: "project", projectId: "project-1" }))).toHaveLength(1);
    expect((await memoryService.list({ kind: "constraint" }))[0]?.id).toBe(projectMemory.id);
  });

  it("rejects project memories without a project id", async () => {
    await expect(memoryService.create({
      scope: "project",
      kind: "fact",
      content: "Needs a project id.",
    })).rejects.toThrow("projectId");
  });

  it("updates and deletes memories", async () => {
    const memory = await memoryService.create({
      scope: "global",
      kind: "decision",
      content: "Ship alpha first.",
    });

    const updated = await memoryService.update(memory.id, { content: "Ship operator alpha first.", kind: "workflow" });
    expect(updated.content).toContain("operator alpha");
    expect(updated.kind).toBe("workflow");

    await memoryService.delete(memory.id);
    expect(await memoryService.get(memory.id)).toBeNull();
  });

  it("limits prompt memories to ten global and ten project entries", async () => {
    for (let index = 0; index < 12; index += 1) {
      await memoryService.create({ scope: "global", kind: "fact", content: `global ${index}` });
      await memoryService.create({ scope: "project", projectId: "project-1", kind: "fact", content: `project ${index}` });
    }

    const promptMemories = await memoryService.getPromptMemories("project-1");
    expect(promptMemories.global).toHaveLength(10);
    expect(promptMemories.project).toHaveLength(10);
  });
});