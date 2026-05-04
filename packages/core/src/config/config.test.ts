import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskSystemPrompt,
  initProjectConfig,
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
});