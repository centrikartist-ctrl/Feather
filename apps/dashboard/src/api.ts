import { resolveApiBaseUrl, requestJson } from "./api-client.js";

const API_BASE = resolveApiBaseUrl((import.meta as ImportMeta & {
  env: {
    DEV?: boolean;
    VITE_FEATHER_API_BASE_URL?: string;
  };
}).env);

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

export type ProjectConfigResponse = {
  name?: string;
  heartbeat?: {
    enabled?: boolean;
    mode?: "off" | "manual" | "passive" | "proactive" | "operator";
    intervalMinutes?: number;
    interval_minutes?: number;
    quietHours?: { start: string; end: string };
    quiet_hours?: { start: string; end: string };
    checks?: {
      git_dirty?: boolean | { enabled?: boolean; cooldownMinutes?: number; cooldown_minutes?: number };
      pending_approvals?: boolean | { enabled?: boolean; cooldownMinutes?: number; cooldown_minutes?: number };
      daily_recap?: boolean | { enabled?: boolean; time?: string };
    };
    instructions?: string[];
  };
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return requestJson<T>(path, options, { apiBaseUrl: API_BASE });
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
    config: (id: string) => request<{ config: ProjectConfigResponse | null }>(`/projects/${id}/config`),
    add: (body: { name: string; rootPath: string }) =>
      request<{ project: import("@feather/shared").Project }>("/projects", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; defaultProviderId?: string | null; codingProviderId?: string | null; planningProviderId?: string | null; heartbeatEnabled?: boolean }) =>
      request<{ project: import("@feather/shared").Project }>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    updateHeartbeat: (id: string, body: { enabled: boolean; mode: "off" | "manual" | "passive" | "proactive"; intervalMinutes: number; quietHours?: { start: string; end: string }; checks: { git_dirty: { enabled: boolean; cooldownMinutes: number }; pending_approvals: { enabled: boolean; cooldownMinutes: number }; daily_recap: { enabled: boolean; time?: string } }; instructions: string[] }) =>
      request<{ config: ProjectConfigResponse }>(`/projects/${id}/heartbeat`, { method: "PATCH", body: JSON.stringify(body) }),
    recap: (id: string) => request<{ recap: string }>(`/projects/${id}/recap`),
  },

  tasks: {
    list: (projectId?: string) =>
      request<{ tasks: import("@feather/shared").Task[] }>(`/tasks${projectId ? `?projectId=${projectId}` : ""}`),
    get: (id: string) => request<{ task: import("@feather/shared").Task }>(`/tasks/${id}`),
    create: (body: { projectId?: string; skillId?: string; title: string; prompt: string; providerId?: string }) =>
      request<{ task: import("@feather/shared").Task }>("/tasks", { method: "POST", body: JSON.stringify(body) }),
    cancel: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
    events: (id: string) => request<{ events: import("@feather/shared").TaskEvent[] }>(`/tasks/${id}/events`),
  },

  memories: {
    list: (filters?: { scope?: "global" | "project"; projectId?: string; kind?: import("@feather/shared").MemoryKind }) => {
      const params = new URLSearchParams();
      if (filters?.scope) params.set("scope", filters.scope);
      if (filters?.projectId) params.set("projectId", filters.projectId);
      if (filters?.kind) params.set("kind", filters.kind);
      const query = params.toString();
      return request<{ memories: import("@feather/shared").Memory[] }>(`/memories${query ? `?${query}` : ""}`);
    },
    create: (body: { scope: "global" | "project"; projectId?: string; kind: import("@feather/shared").MemoryKind; content: string; sourceTaskId?: string }) =>
      request<{ memory: import("@feather/shared").Memory }>("/memories", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { projectId?: string; kind?: import("@feather/shared").MemoryKind; content?: string }) =>
      request<{ memory: import("@feather/shared").Memory }>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => request<{ ok: boolean }>(`/memories/${id}`, { method: "DELETE" }),
  },

  skills: {
    list: (filters?: { scope?: "global" | "project"; projectId?: string }) => {
      const params = new URLSearchParams();
      if (filters?.scope) params.set("scope", filters.scope);
      if (filters?.projectId) params.set("projectId", filters.projectId);
      const query = params.toString();
      return request<{ skills: import("@feather/shared").Skill[] }>(`/skills${query ? `?${query}` : ""}`);
    },
    get: (id: string) => request<{ skill: import("@feather/shared").Skill }>(`/skills/${encodeURIComponent(id)}`),
    create: (body: { scope: "global" | "project"; projectId?: string; id: string; name: string; purpose?: string; allowedTools: string[]; instructions: string; output?: string }) =>
      request<{ skill: import("@feather/shared").Skill }>("/skills", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; purpose?: string; allowedTools?: string[]; instructions?: string; output?: string }) =>
      request<{ skill: import("@feather/shared").Skill }>(`/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id: string) => request<{ ok: boolean }>(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
