import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db/index.js";
import { projects } from "../db/schema.js";
import { loadProjectFileConfig, initProjectConfig } from "../config/index.js";
import type { Project } from "@feather/shared";
import { NotFoundError, ValidationError } from "@feather/shared";

export type AddProjectInput = {
  name: string;
  rootPath: string;
  defaultProviderId?: string;
};

export class ProjectService {
  async addProject(input: AddProjectInput): Promise<Project> {
    const rootPath = path.resolve(input.rootPath);

    if (!fs.existsSync(rootPath)) {
      throw new ValidationError(`Project path does not exist: ${rootPath}`);
    }

    const db = getDb();

    // Check for duplicate
    const existing = await db
      .select()
      .from(projects)
      .where(eq(projects.rootPath, rootPath))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      throw new ValidationError(`Project already registered: ${rootPath}`);
    }

    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(projects).values({
      id,
      name: input.name,
      rootPath,
      defaultProviderId: input.defaultProviderId,
      heartbeatEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    // Initialise .feather/ config if not present
    initProjectConfig(rootPath, input.name);

    return {
      id,
      name: input.name,
      rootPath,
      defaultProviderId: input.defaultProviderId,
      heartbeatEnabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listProjects(): Promise<Project[]> {
    const db = getDb();
    const rows = await db.select().from(projects);
    return rows.map(rowToProject);
  }

  async getProject(id: string): Promise<Project> {
    const db = getDb();
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError("Project", id);
    return rowToProject(row);
  }

  async getProjectByPath(rootPath: string): Promise<Project | null> {
    const db = getDb();
    const resolved = path.resolve(rootPath);
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.rootPath, resolved))
      .limit(1);
    return rows[0] ? rowToProject(rows[0]) : null;
  }

  async updateProject(
    id: string,
    updates: Partial<{
      name: Project["name"];
      defaultProviderId: Project["defaultProviderId"] | null;
      codingProviderId: Project["codingProviderId"] | null;
      planningProviderId: Project["planningProviderId"] | null;
      heartbeatEnabled: Project["heartbeatEnabled"];
    }>,
  ): Promise<Project> {
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(projects)
      .set({ ...updates, updatedAt: now })
      .where(eq(projects.id, id));

    return this.getProject(id);
  }

  async getProjectConfig(id: string) {
    const project = await this.getProject(id);
    return loadProjectFileConfig(project.rootPath);
  }
}

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    defaultProviderId: row.defaultProviderId ?? undefined,
    codingProviderId: row.codingProviderId ?? undefined,
    planningProviderId: row.planningProviderId ?? undefined,
    heartbeatEnabled: row.heartbeatEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
