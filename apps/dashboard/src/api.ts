const API_BASE = "";

export type OnboardingState = {
  stage: "machine" | "agent" | "complete";
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

export type MachineSetupRequest = {
  provider?: Record<string, unknown>;
  project?: {
    name: string;
    rootPath: string;
    codingProviderId?: string;
  };
  telegram: {
    enabled: boolean;
    botToken?: string;
    allowedUserIds?: number[];
  };
};

export type AgentProfileRequest = {
  name: string;
  role: string;
  mission: string;
  tone: string;
  autonomy: string;
  boundaries: string | string[];
  workflow: string | string[];
  reporting: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; version: string; panic: { active: boolean } }>("/health"),

  onboarding: {
    state: () => request<{
      state: OnboardingState;
    }>("/onboarding/state"),
    completeMachine: (body: MachineSetupRequest) =>
      request<{ ok: boolean; requiresDaemonRestart: boolean; state: OnboardingState }>("/onboarding/machine-setup", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    completeAgent: (body: AgentProfileRequest) =>
      request<{ ok: boolean; agentPath: string; content: string; state: OnboardingState }>("/onboarding/agent-profile", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  projects: {
    list: () => request<{ projects: import("@feather/shared").Project[] }>("/projects"),
    get: (id: string) => request<{ project: import("@feather/shared").Project }>(`/projects/${id}`),
    add: (body: { name: string; rootPath: string }) =>
      request<{ project: import("@feather/shared").Project }>("/projects", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; defaultProviderId?: string | null; codingProviderId?: string | null; planningProviderId?: string | null; heartbeatEnabled?: boolean }) =>
      request<{ project: import("@feather/shared").Project }>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    recap: (id: string) => request<{ recap: string }>(`/projects/${id}/recap`),
  },

  tasks: {
    list: (projectId?: string) =>
      request<{ tasks: import("@feather/shared").Task[] }>(`/tasks${projectId ? `?projectId=${projectId}` : ""}`),
    get: (id: string) => request<{ task: import("@feather/shared").Task }>(`/tasks/${id}`),
    create: (body: { projectId?: string; title: string; prompt: string; providerId?: string }) =>
      request<{ task: import("@feather/shared").Task }>("/tasks", { method: "POST", body: JSON.stringify(body) }),
    cancel: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
    events: (id: string) => request<{ events: import("@feather/shared").TaskEvent[] }>(`/tasks/${id}/events`),
  },

  approvals: {
    list: (projectId?: string) =>
      request<{ approvals: import("@feather/shared").Approval[] }>(`/approvals${projectId ? `?projectId=${projectId}` : ""}`),
    resolve: (id: string, decision: "approved" | "rejected", scope?: string) =>
      request<{ approval: import("@feather/shared").Approval }>(`/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, scope }),
      }),
  },

  heartbeat: {
    run: () => request<{ ok: boolean; summary: string }>("/heartbeat/run", { method: "POST" }),
    observations: (projectId?: string) =>
      request<{ observations: import("@feather/shared").Observation[] }>(
        `/observations${projectId ? `?projectId=${projectId}` : ""}`,
      ),
  },

  providers: {
    list: () =>
      request<{ providers: Array<{ id: string; name: string; type: string; enabled: boolean; config: Record<string, unknown>; capabilities: import("@feather/shared").ProviderCapabilities | null; costEnforcementMode: "known" | "estimated" | "unknown"; budgetWarning: string }> }>("/providers"),
    create: (body: Record<string, unknown>) =>
      request<{ provider: { id: string; name: string; type: string; enabled: boolean; config: Record<string, unknown> } }>("/providers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    validate: (id: string) =>
      request<{ health: import("@feather/shared").ProviderHealth }>(`/providers/${id}/validate`, { method: "POST" }),
  },

  budgets: {
    dailySpend: (projectId?: string) =>
      request<{ dailySpendCents: number }>(`/budgets/daily-spend${projectId ? `?projectId=${projectId}` : ""}`),
  },

  panic: () => request<{ ok: boolean }>("/panic", { method: "POST" }),
  resume: () => request<{ ok: boolean }>("/resume", { method: "POST" }),
};
