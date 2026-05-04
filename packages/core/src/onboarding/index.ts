export type OnboardingStage = "machine" | "agent" | "complete";

export type OnboardingState = {
  stage: OnboardingStage;
  machine: {
    complete: boolean;
    providerCount: number;
    projectCount: number;
    telegramConfigured: boolean;
    telegramStepCompleted: boolean;
  };
  agent: {
    complete: boolean;
    agentFileExists: boolean;
    agentName?: string;
  };
  paths: {
    featherHomeDir: string;
    globalConfigPath: string;
    globalAgentFilePath: string;
  };
};

export type DeriveOnboardingStateInput = {
  providerCount: number;
  projectCount: number;
  telegramConfigured: boolean;
  telegramStepCompleted: boolean;
  machineSetupCompletedFlag: boolean;
  hasGlobalAgent: boolean;
  agentSetupCompletedFlag: boolean;
  featherHomeDir: string;
  globalConfigPath: string;
  globalAgentFilePath: string;
  agentName?: string;
};

export type AgentProfileInput = {
  name: string;
  role: string;
  mission: string;
  tone: string;
  autonomy: string;
  boundaries: string[];
  workflow: string[];
  reporting: string;
};

export function deriveOnboardingState(input: DeriveOnboardingStateInput): OnboardingState {
  const machineComplete = input.machineSetupCompletedFlag || (
    input.providerCount > 0 &&
    input.projectCount > 0 &&
    input.telegramStepCompleted
  );
  const agentComplete = input.agentSetupCompletedFlag || input.hasGlobalAgent;
  const stage: OnboardingStage = !machineComplete ? "machine" : !agentComplete ? "agent" : "complete";

  return {
    stage,
    machine: {
      complete: machineComplete,
      providerCount: input.providerCount,
      projectCount: input.projectCount,
      telegramConfigured: input.telegramConfigured,
      telegramStepCompleted: input.telegramStepCompleted,
    },
    agent: {
      complete: agentComplete,
      agentFileExists: input.hasGlobalAgent,
      ...(input.agentName ? { agentName: input.agentName } : {}),
    },
    paths: {
      featherHomeDir: input.featherHomeDir,
      globalConfigPath: input.globalConfigPath,
      globalAgentFilePath: input.globalAgentFilePath,
    },
  };
}

export function normalizeOnboardingList(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  return value
    .split(/\r?\n|;/)
    .map((entry) => entry.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function buildAgentMarkdown(input: AgentProfileInput): string {
  return `# ${input.name}

## Identity

- Name: ${input.name}
- Role: ${input.role}
- Mission: ${input.mission}

## Communication style

- Tone: ${input.tone}
- Reporting: ${input.reporting}

## Autonomy

- ${input.autonomy}

## Boundaries

${toBulletList(input.boundaries)}

## Workflow preferences

${toBulletList(input.workflow)}

## Operating notes

- Keep changes as small and testable as possible.
- Surface assumptions and risks clearly.
- Preserve user-owned project instructions and repo guidance.
`;
}

export function extractAgentName(content: string | null | undefined): string | undefined {
  if (!content) return undefined;
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || undefined;
}

function toBulletList(entries: string[]): string {
  return entries.length > 0
    ? entries.map((entry) => `- ${entry}`).join("\n")
    : "- None specified yet.";
}