import fs from "node:fs";
import path from "node:path";
import { FEATHER_CONFIG_DIR, FEATHER_SKILLS_DIR, type Project, type Skill, type SkillScope } from "@feather/shared";
import { getFeatherHomeDir } from "../config/index.js";
import type { ProjectService } from "../projects/index.js";

export type UpsertSkillInput = {
  scope: SkillScope;
  projectId?: string;
  id: string;
  name: string;
  purpose?: string;
  allowedTools: string[];
  instructions: string;
  output?: string;
};

export class SkillService {
  constructor(private readonly projects: ProjectService) {}

  async list(filters: { scope?: SkillScope; projectId?: string } = {}): Promise<Skill[]> {
    const skills: Skill[] = [];
    if (!filters.scope || filters.scope === "global") {
      skills.push(...this.readSkillsFromDirectory(getGlobalSkillsDir(), "global"));
    }

    if (!filters.scope || filters.scope === "project") {
      const projects = filters.projectId
        ? [await this.projects.getProject(filters.projectId)]
        : await this.projects.listProjects();
      for (const project of projects) {
        skills.push(...this.readSkillsFromDirectory(getProjectSkillsDir(project.rootPath), "project", project));
      }
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string): Promise<Skill | null> {
    const parsedId = parseSkillId(id);
    const project = parsedId.scope === "project" && parsedId.projectId
      ? await this.projects.getProject(parsedId.projectId)
      : undefined;
    const filePath = this.resolveSkillPath(parsedId.scope, parsedId.slug, project);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return parseSkillMarkdown(fs.readFileSync(filePath, "utf8"), filePath, parsedId.scope, project?.id, parsedId.slug);
  }

  async create(input: UpsertSkillInput): Promise<Skill> {
    validateSkillInput(input);
    const project = input.scope === "project" && input.projectId
      ? await this.projects.getProject(input.projectId)
      : undefined;
    const skillId = buildSkillId(input.scope, input.id, project?.id);
    const filePath = this.resolveSkillPath(input.scope, input.id, project);
    ensureSkillDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, renderSkillMarkdown(input), "utf8");
    const skill = await this.get(skillId);
    if (!skill) {
      throw new Error(`Failed to persist skill: ${skillId}`);
    }
    return skill;
  }

  async update(id: string, input: Partial<Omit<UpsertSkillInput, "scope" | "projectId" | "id">>): Promise<Skill> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }
    const next: UpsertSkillInput = {
      scope: existing.scope,
      projectId: existing.projectId,
      id: parseSkillId(id).slug,
      name: input.name ?? existing.name,
      purpose: input.purpose ?? existing.purpose,
      allowedTools: input.allowedTools ?? existing.allowedTools,
      instructions: input.instructions ?? existing.instructions,
      output: input.output ?? existing.output,
    };
    return this.create(next);
  }

  async delete(id: string): Promise<void> {
    const parsedId = parseSkillId(id);
    const project = parsedId.scope === "project" && parsedId.projectId
      ? await this.projects.getProject(parsedId.projectId)
      : undefined;
    const filePath = this.resolveSkillPath(parsedId.scope, parsedId.slug, project);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }

  async getTaskSkill(skillId?: string): Promise<Skill | undefined> {
    if (!skillId) {
      return undefined;
    }
    const skill = await this.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return skill;
  }

  isToolAllowed(skill: Skill | undefined, toolName: string): boolean {
    if (!skill || skill.allowedTools.length === 0) {
      return true;
    }
    const normalizedTool = normalizeAllowedTool(toolName);
    return skill.allowedTools.some((allowedTool: string) => normalizeAllowedTool(allowedTool) === normalizedTool);
  }

  private resolveSkillPath(scope: SkillScope, slug: string, project?: Project): string {
    assertSafeSlug(slug);
    const dir = scope === "global"
      ? getGlobalSkillsDir()
      : getProjectSkillsDir(project?.rootPath ?? "");
    return path.join(dir, `${slug}.md`);
  }

  private readSkillsFromDirectory(dirPath: string, scope: SkillScope, project?: Project): Skill[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    return fs.readdirSync(dirPath)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => {
        const slug = path.basename(entry, ".md");
        const fullPath = path.join(dirPath, entry);
        return parseSkillMarkdown(fs.readFileSync(fullPath, "utf8"), fullPath, scope, project?.id, slug);
      });
  }
}

export function parseSkillMarkdown(markdown: string, filePath: string, scope: SkillScope, projectId: string | undefined, slug: string): Skill {
  const nameMatch = markdown.match(/^#\s+(.+)$/m);
  if (!nameMatch?.[1]) {
    throw new Error(`Malformed skill file ${filePath}: missing H1 title.`);
  }
  const instructions = extractSection(markdown, "Instructions");
  if (!instructions) {
    throw new Error(`Malformed skill file ${filePath}: missing Instructions section.`);
  }
  const allowedToolsSection = extractSection(markdown, "Allowed tools");
  const allowedTools = allowedToolsSection
    ? allowedToolsSection
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => normalizeAllowedTool(line.slice(2).trim()))
        .filter(Boolean)
    : [];
  const purpose = extractSection(markdown, "Purpose") || undefined;
  const output = extractSection(markdown, "Output") || undefined;
  return {
    id: buildSkillId(scope, slug, projectId),
    name: nameMatch[1].trim(),
    scope,
    ...(projectId ? { projectId } : {}),
    path: filePath,
    ...(purpose ? { purpose } : {}),
    allowedTools,
    instructions,
    ...(output ? { output } : {}),
  };
}

export function normalizeAllowedTool(value: string): string {
  return value.split(":")[0]!.replace(/\s+with approval$/i, "").trim();
}

function extractSection(markdown: string, sectionName: string): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^##\\s+${escapedName}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$)`, "im"));
  return match?.[1]?.trim() ?? "";
}

function renderSkillMarkdown(input: UpsertSkillInput): string {
  const lines = [
    `# ${input.name}`,
    "",
    "## Purpose",
    input.purpose?.trim() || "Describe what this workflow is for.",
    "",
    "## Allowed tools",
    ...(input.allowedTools.length > 0 ? input.allowedTools.map((tool) => `- ${tool}`) : ["- filesystem.readFile"]),
    "",
    "## Instructions",
    input.instructions.trim(),
  ];
  if (input.output?.trim()) {
    lines.push("", "## Output", input.output.trim());
  }
  return lines.join("\n");
}

function buildSkillId(scope: SkillScope, slug: string, projectId?: string): string {
  return scope === "global" ? `global:${slug}` : `project:${projectId}:${slug}`;
}

function parseSkillId(id: string): { scope: SkillScope; projectId?: string; slug: string } {
  if (id.startsWith("global:")) {
    return { scope: "global", slug: id.slice("global:".length) };
  }
  if (id.startsWith("project:")) {
    const [, projectId, ...rest] = id.split(":");
    return { scope: "project", projectId, slug: rest.join(":") };
  }
  throw new Error(`Invalid skill id: ${id}`);
}

function validateSkillInput(input: UpsertSkillInput): void {
  assertSafeSlug(input.id);
  if (!input.name.trim()) {
    throw new Error("Skill name cannot be empty.");
  }
  if (!input.instructions.trim()) {
    throw new Error("Skill instructions cannot be empty.");
  }
  if (input.scope === "project" && !input.projectId) {
    throw new Error("Project skills require a projectId.");
  }
}

function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(slug)) {
    throw new Error(`Invalid skill id: ${slug}`);
  }
}

function ensureSkillDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getGlobalSkillsDir(): string {
  return path.join(getFeatherHomeDir(), FEATHER_SKILLS_DIR);
}

function getProjectSkillsDir(projectRoot: string): string {
  return path.join(projectRoot, FEATHER_CONFIG_DIR, FEATHER_SKILLS_DIR);
}