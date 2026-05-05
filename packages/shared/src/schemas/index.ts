import { z } from "zod";

export const RiskLevelSchema = z.enum(["safe", "review", "dangerous", "blocked"]);

export const TaskStatusSchema = z.enum([
  "queued",
  "planning",
  "awaiting_approval",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  defaultProviderId: z.string().optional(),
  codingProviderId: z.string().optional(),
  planningProviderId: z.string().optional(),
  heartbeatEnabled: z.boolean(),
});

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  status: TaskStatusSchema,
  providerId: z.string(),
  createdBy: z.enum(["dashboard", "cli", "telegram", "heartbeat"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApprovalSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  title: z.string(),
  reason: z.string(),
  actionType: z.enum(["shell", "filesystem", "git", "provider", "network", "scheduler"]),
  risk: RiskLevelSchema,
  payload: z.unknown(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  approvedScope: z.enum(["once", "project", "global_pattern"]).optional(),
});

export const SuggestedActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  providerHint: z.string().optional(),
  requiresApproval: z.boolean(),
});

export const ObservationSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  source: z.enum(["heartbeat", "task", "tool", "provider"]),
  severity: z.enum(["info", "suggestion", "warning", "blocked"]),
  title: z.string(),
  body: z.string(),
  suggestedActions: z.array(SuggestedActionSchema),
  createdAt: z.string(),
});

export const ProviderConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["codex-cli", "openai", "openai-compatible", "openrouter"]),
  name: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MemoryScopeSchema = z.enum(["global", "project"]);
export const MemoryKindSchema = z.enum(["preference", "fact", "decision", "constraint", "workflow"]);

export const MemorySchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  projectId: z.string().optional(),
  kind: MemoryKindSchema,
  content: z.string(),
  sourceTaskId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SkillScopeSchema = z.enum(["global", "project"]);

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: SkillScopeSchema,
  projectId: z.string().optional(),
  path: z.string(),
  purpose: z.string().optional(),
  allowedTools: z.array(z.string()),
  instructions: z.string(),
  output: z.string().optional(),
});

export const HeartbeatModeSchema = z.enum(["off", "manual", "passive", "proactive", "operator"]);

export const SafetyPresetSchema = z.enum(["conservative", "builder", "operator"]);

// Project config file schemas
export const ProjectPermissionsSchema = z.object({
  filesystem: z
    .object({
      read: z.array(z.string()).optional(),
      write: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  shell: z
    .object({
      allow: z.array(z.string()).optional(),
      require_approval: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

export const ProjectFileConfigSchema = z.object({
  name: z.string(),
  root: z.string().optional(),
  providers: z
    .object({
      planning: z.string().optional(),
      coding: z.string().optional(),
      summarising: z.string().optional(),
    })
    .optional(),
  permissions: ProjectPermissionsSchema.optional(),
  heartbeat: z
    .object({
      enabled: z.boolean().optional(),
      mode: HeartbeatModeSchema.optional(),
      intervalMinutes: z.number().optional(),
      interval_minutes: z.number().optional(),
      checks: z
        .object({
          git_dirty: z.union([
            z.boolean(),
            z.object({ enabled: z.boolean().optional(), cooldownMinutes: z.number().optional(), cooldown_minutes: z.number().optional() }),
          ]).optional(),
          pending_approvals: z.union([
            z.boolean(),
            z.object({ enabled: z.boolean().optional(), cooldownMinutes: z.number().optional(), cooldown_minutes: z.number().optional() }),
          ]).optional(),
          daily_recap: z.union([
            z.boolean(),
            z.object({ enabled: z.boolean().optional(), time: z.string().optional() }),
          ]).optional(),
        })
        .optional(),
      quietHours: z
        .object({
          start: z.string(),
          end: z.string(),
        })
        .optional(),
      quiet_hours: z
        .object({
          start: z.string(),
          end: z.string(),
        })
        .optional(),
      instructions: z.array(z.string()).optional(),
    })
    .optional(),
  agent: z
    .object({
      instructions_file: z.string().optional(),
      allow_agent_to_suggest_instruction_updates: z.boolean().optional(),
      require_approval_for_instruction_updates: z.boolean().optional(),
    })
    .optional(),
});

export const CreateTaskRequestSchema = z.object({
  projectId: z.string().optional(),
  skillId: z.string().optional(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  providerId: z.string().optional(),
  budgetCents: z.number().int().positive().optional(),
});

export const ResolveApprovalRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  scope: z.enum(["once", "project", "global_pattern"]).optional(),
});
