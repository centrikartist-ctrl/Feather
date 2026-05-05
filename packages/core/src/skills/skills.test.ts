import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { ProjectService } from "../projects/index.js";
import { SkillService, normalizeAllowedTool, parseSkillMarkdown } from "./index.js";

let tempDir: string;
let projects: ProjectService;
let skills: SkillService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-skills-test-"));
  vi.stubEnv("FEATHER_HOME_DIR", path.join(tempDir, "home"));
  initDb(path.join(tempDir, "test.db"));
  projects = new ProjectService();
  skills = new SkillService(projects);
});

afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("SkillService", () => {
  it("creates and loads global and project skills", async () => {
    const projectRoot = path.join(tempDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "Feather", rootPath: projectRoot });

    const globalSkill = await skills.create({
      scope: "global",
      id: "safe-ui-pass",
      name: "Safe UI Pass",
      purpose: "Improve UI without changing behavior.",
      allowedTools: ["filesystem.readFile", "filesystem.writeFile with approval"],
      instructions: "Do not add features.",
      output: "summary",
    });
    const projectSkill = await skills.create({
      scope: "project",
      projectId: project.id,
      id: "docs-pass",
      name: "Docs Pass",
      allowedTools: ["filesystem.readFile", "filesystem.writeFile"],
      instructions: "Update docs only.",
    });

    expect(globalSkill.id).toBe("global:safe-ui-pass");
    expect(projectSkill.id).toBe(`project:${project.id}:docs-pass`);
    expect((await skills.list({ scope: "global" }))).toHaveLength(1);
    expect((await skills.list({ scope: "project", projectId: project.id }))).toHaveLength(1);
  });

  it("rejects invalid skill ids and malformed markdown", async () => {
    await expect(skills.create({
      scope: "global",
      id: "../escape",
      name: "Bad",
      allowedTools: [],
      instructions: "Nope",
    })).rejects.toThrow("Invalid skill id");

    expect(() => parseSkillMarkdown("## Instructions\nMissing title", "skill.md", "global", undefined, "skill")).toThrow("missing H1");
  });

  it("normalizes tool entries for upper-bound enforcement", () => {
    expect(normalizeAllowedTool("shell.run: npm test")).toBe("shell.run");
    expect(normalizeAllowedTool("filesystem.writeFile with approval")).toBe("filesystem.writeFile");
  });
});