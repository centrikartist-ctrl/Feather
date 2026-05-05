import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskSystemPrompt,
  initProjectConfig,
  loadGlobalConfig,
  loadGlobalAgentInstructions,
  loadProjectFileConfig,
  saveGlobalAgentInstructions,
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("project config loading", () => {
  it("creates and loads the default project config", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feather-config-test-"));
    tempDirs.push(projectRoot);

    initProjectConfig(projectRoot, "config-test");
    const config = loadProjectFileConfig(projectRoot);

    expect(config).not.toBeNull();
    expect(config?.name).toBe("config-test");
    expect(config?.permissions?.filesystem?.write).toContain("src");
    expect(config?.heartbeat?.mode).toBe("passive");
  });

  it("persists the global agent file under the Feather home directory", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "feather-home-test-"));
    tempDirs.push(fakeHome);
    vi.stubEnv("FEATHER_HOME_DIR", fakeHome);

    saveGlobalAgentInstructions("# Test Agent\n\n## Identity\n\n- Role: regression test");

    expect(loadGlobalAgentInstructions()).toContain("Test Agent");
    expect(fs.existsSync(path.join(fakeHome, "agent.md"))).toBe(true);
  });

  it("applies safe Telegram freeform defaults in global config", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "feather-home-test-"));
    tempDirs.push(fakeHome);
    vi.stubEnv("FEATHER_HOME_DIR", fakeHome);

    const config = loadGlobalConfig();

    expect(config.telegram?.freeform?.enabled).toBe(true);
    expect(config.telegram?.freeform?.confirmations?.readOnly).toBe(false);
    expect(config.telegram?.freeform?.confirmations?.createTask).toBe(true);
    expect(config.telegram?.chat?.enabled).toBe(true);
    expect(config.telegram?.chat?.maxContextMessages).toBe(12);
    expect(config.telegram?.chat?.maxOutputTokens).toBe(700);
  });

  it("derives the default db path from the current Feather home env", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "feather-home-test-"));
    tempDirs.push(fakeHome);
    vi.stubEnv("FEATHER_HOME_DIR", fakeHome);

    const config = loadGlobalConfig();

    expect(config.dbPath).toBe(path.join(fakeHome, "feather.db"));
  });

  it("builds a shared system prompt from global, project, repo, and runtime layers", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "feather-home-test-"));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feather-project-test-"));
    tempDirs.push(fakeHome, projectRoot);
    vi.stubEnv("FEATHER_HOME_DIR", fakeHome);

    saveGlobalAgentInstructions("# Global Agent\n\nGlobal rules");
    initProjectConfig(projectRoot, "prompt-test");
    fs.writeFileSync(path.join(projectRoot, ".feather", "instructions.md"), "Project rules", "utf8");
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "Repo rules", "utf8");

    const prompt = buildTaskSystemPrompt({ projectRoot, runtimeSystemPrompt: "Runtime rules" });

    expect(prompt).toContain("Global Agent Profile");
    expect(prompt).toContain("Project Instructions");
    expect(prompt).toContain("Repository AGENTS.md");
    expect(prompt).toContain("Runtime Guidance");
  });

  it("includes explicit memories and selected skill context in the system prompt", () => {
    const prompt = buildTaskSystemPrompt({
      explicitMemories: {
        global: [{ id: "g1", scope: "global", kind: "preference", content: "Keep summaries short.", createdAt: "1", updatedAt: "1" }],
        project: [{ id: "p1", scope: "project", projectId: "proj", kind: "constraint", content: "Do not add features.", createdAt: "1", updatedAt: "1" }],
      },
      selectedSkill: {
        id: "global:safe-ui-pass",
        name: "Safe UI Pass",
        scope: "global",
        path: "C:/skills/safe-ui-pass.md",
        purpose: "Improve UI without feature changes.",
        allowedTools: ["filesystem.readFile", "filesystem.writeFile"],
        instructions: "Preserve routing.",
        output: "summary",
      },
    });

    expect(prompt).toContain("Explicit Feather Memories");
    expect(prompt).toContain("Keep summaries short.");
    expect(prompt).toContain("Do not add features.");
    expect(prompt).toContain("Selected Feather Skill");
    expect(prompt).toContain("Safe UI Pass");
  });
});