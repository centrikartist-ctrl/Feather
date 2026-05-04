import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "./codex-cli.js";

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

  it("adds --full-auto for approvalMode 'auto'", () => {
    const { args } = buildCodexArgs({ approvalMode: "auto" }, { prompt: "Go" });
    expect(args).toContain("--full-auto");
  });

  it("does NOT add --full-auto for approvalMode 'feather'", () => {
    const { args } = buildCodexArgs(
      { approvalMode: "feather" },
      { prompt: "Go" },
    );
    expect(args).not.toContain("--full-auto");
  });

  it("adds --dangerously-auto-approve-everything for mode 'exec'", () => {
    const { args } = buildCodexArgs({ mode: "exec" }, { prompt: "Go" });
    expect(args).toContain("--dangerously-auto-approve-everything");
  });

  it("does NOT add the dangerous flag for mode 'apply'", () => {
    const { args } = buildCodexArgs({ mode: "apply" }, { prompt: "Go" });
    expect(args).not.toContain("--dangerously-auto-approve-everything");
  });

  it("produces no extra flags when config is empty", () => {
    const { args } = buildCodexArgs({}, { prompt: "Simple" });
    expect(args).toEqual(["Simple"]);
  });
});
