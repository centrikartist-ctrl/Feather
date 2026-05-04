import { describe, expect, it } from "vitest";
import { buildAgentMarkdown, deriveOnboardingState, normalizeOnboardingList } from "./index.js";

describe("onboarding helpers", () => {
  it("keeps the user in machine setup until provider, project, and telegram decision exist", () => {
    const state = deriveOnboardingState({
      providerCount: 1,
      projectCount: 1,
      telegramConfigured: false,
      telegramStepCompleted: false,
      machineSetupCompletedFlag: false,
      hasGlobalAgent: false,
      agentSetupCompletedFlag: false,
      featherHomeDir: "C:/Users/test/.feather",
      globalConfigPath: "C:/Users/test/.feather/config.yml",
      globalAgentFilePath: "C:/Users/test/.feather/agent.md",
    });

    expect(state.stage).toBe("machine");
    expect(state.machine.complete).toBe(false);
  });

  it("builds agent markdown with normalized list fields", () => {
    const content = buildAgentMarkdown({
      name: "Feather Ops",
      role: "Senior engineering copilot",
      mission: "Ship safely.",
      tone: "Direct and concise.",
      autonomy: "Handle routine work, ask before risky actions.",
      boundaries: normalizeOnboardingList("Never deploy without approval\nNever edit env files without approval"),
      workflow: normalizeOnboardingList("Start from the concrete failing surface;Run focused validation first"),
      reporting: "Summarise results, validation, and risks.",
    });

    expect(content).toContain("# Feather Ops");
    expect(content).toContain("Never deploy without approval");
    expect(content).toContain("Run focused validation first");
  });
});