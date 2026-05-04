import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "./codex-cli.js";

const DANGEROUS_PATTERNS = [
  "--dangerously-auto-approve-everything",
  "--full-auto",
  "--auto-approve",
  "--bypass-approval",
  "--skip-approval",
];

describe("buildCodexArgs", () => {
  it("uses 'codex' as the default command", () => {
    const { command } = buildCodexArgs({}, { prompt: "Fix the bug" });
    expect(command).toBe("codex");
  });

  it("uses a custom command when specified", () => {
    const { command } = buildCodexArgs(
      { command: "/usr/local/bin/codex" },
      { prompt: "Go" },
    );
    expect(command).toBe("/usr/local/bin/codex");
  });

  it("appends the prompt as the last argument", () => {
    const { args } = buildCodexArgs({}, { prompt: "Write tests" });
    expect(args[args.length - 1]).toBe("Write tests");
  });

  it("inserts --instructions before the prompt when systemPrompt is provided", () => {
    const { args } = buildCodexArgs(
      {},
      { prompt: "Do task", systemPrompt: "Be concise" },
    );
    const idx = args.indexOf("--instructions");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("Be concise");
    expect(args[args.length - 1]).toBe("Do task");
  });

  it("produces no extra flags when config is empty", () => {
    const { args } = buildCodexArgs({}, { prompt: "Simple" });
    expect(args).toEqual(["Simple"]);
  });

  // Safety: dangerous auto-approval flags must NEVER appear regardless of config.
  it("does NOT add --full-auto for approvalMode 'auto'", () => {
    const { args } = buildCodexArgs({ approvalMode: "auto" } as any, { prompt: "Go" });
    expect(args).not.toContain("--full-auto");
  });

  it("does NOT add --dangerously-auto-approve-everything for mode 'exec'", () => {
    const { args } = buildCodexArgs({ mode: "exec" }, { prompt: "Go" });
    expect(args).not.toContain("--dangerously-auto-approve-everything");
  });

  it("does NOT add --dangerously-auto-approve-everything for mode 'apply'", () => {
    const { args } = buildCodexArgs({ mode: "apply" }, { prompt: "Go" });
    expect(args).not.toContain("--dangerously-auto-approve-everything");
  });

  it("never emits any dangerous approval bypass flag regardless of config", () => {
    const configs = [
      { approvalMode: "auto" },
      { mode: "exec" as const },
      { approvalMode: "auto", mode: "exec" as const },
      {},
    ];

    for (const config of configs) {
      const { args } = buildCodexArgs(config as any, { prompt: "test" });
      for (const dangerous of DANGEROUS_PATTERNS) {
        expect(args).not.toContain(dangerous);
      }
      // Also check no arg contains substring patterns
      const joinedArgs = args.join(" ");
      expect(joinedArgs).not.toMatch(/danger/i);
      expect(joinedArgs).not.toMatch(/auto-approve/i);
      expect(joinedArgs).not.toMatch(/full-auto/i);
      expect(joinedArgs).not.toMatch(/bypass/i);
      expect(joinedArgs).not.toMatch(/skip-approval/i);
    }
  });
});
