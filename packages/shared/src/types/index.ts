export type Project = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  defaultProviderId?: string;
  codingProviderId?: string;
  planningProviderId?: string;
  heartbeatEnabled: boolean;
};

export type TaskStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type Task = {
  id: string;
  projectId?: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  providerId: string;
  createdBy: "dashboard" | "cli" | "telegram" | "heartbeat";
  createdAt: string;
  updatedAt: string;
};

export type RiskLevel = "safe" | "review" | "dangerous" | "blocked";

export type TaskEvent =
  | { type: "message"; role: "user" | "assistant" | "system"; content: string }
  | { type: "provider_event"; providerId: string; event: unknown }
  | { type: "tool_call_requested"; toolId: string; actionId: string; input: unknown; risk: RiskLevel }
  | { type: "approval_requested"; approvalId: string }
  | { type: "approval_resolved"; approvalId: string; decision: "approved" | "rejected" }
  | { type: "tool_result"; toolId: string; actionId: string; output: unknown }
  | { type: "diff"; path: string; diff: string }
  | { type: "command_output"; command: string; stdout?: string; stderr?: string; exitCode?: number }
  | { type: "summary"; content: string }
  | { type: "error"; message: string; details?: unknown };

export type Approval = {
  id: string;
  taskId?: string;
  projectId?: string;
  title: string;
  reason: string;
  actionType: "shell" | "filesystem" | "git" | "provider" | "network" | "scheduler";
  risk: RiskLevel;
  payload: unknown;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  resolvedAt?: string;
  approvedScope?: "once" | "project" | "global_pattern";
};

export type SuggestedAction = {
  id: string;
  label: string;
  prompt: string;
  providerHint?: string;
  requiresApproval: boolean;
};

export type Observation = {
  id: string;
  projectId?: string;
  source: "heartbeat" | "task" | "tool" | "provider";
  severity: "info" | "suggestion" | "warning" | "blocked";
  title: string;
  body: string;
  suggestedActions: SuggestedAction[];
  createdAt: string;
};

export type ProviderCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  coding: boolean;
  reasoning: boolean;
  costEstimate: boolean;
  supportsProjectRoot: boolean;
};

export type ProviderHealth = {
  ok: boolean;
  message: string;
};

export type TaskInput = {
  taskId: string;
  project?: Project;
  prompt: string;
  systemPrompt?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  budgetCents?: number;
};

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_request"; toolName: string; input: unknown }
  | { type: "approval_request"; payload: unknown }
  | { type: "file_diff"; path: string; diff: string }
  | { type: "command_output"; command: string; output: string }
  | { type: "cost_estimate"; inputTokens?: number; outputTokens?: number; estimatedCents?: number }
  | { type: "done"; summary: string }
  | { type: "error"; error: string };

export type ToolPermission = {
  scope: string;
  description: string;
};

export type ToolResult = {
  ok: boolean;
  output?: unknown;
  diff?: string;
  error?: string;
};

export type ApprovalCard = {
  title: string;
  projectName?: string;
  action: string;
  reason: string;
  risk: RiskLevel;
  scope: string;
  rawPayload: unknown;
  options: ["approve_once", "approve_project", "reject", "deny_pattern"];
};

export type BudgetConfig = {
  dailyLimitCents?: number;
  taskLimitCents?: number;
  heartbeatDailyLimitCents?: number;
  providerLimits?: Record<string, { dailyLimitCents?: number; taskLimitCents?: number }>;
};

export type HeartbeatMode = "off" | "manual" | "passive" | "proactive" | "operator";

export type SafetyPreset = "conservative" | "builder" | "operator";

export type DaemonStatus = "running" | "stopped" | "panicked";

export type PanicState = {
  active: boolean;
  activatedAt?: string;
};
