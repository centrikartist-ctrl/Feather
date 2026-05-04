import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull().unique(),
  defaultProviderId: text("default_provider_id"),
  codingProviderId: text("coding_provider_id"),
  planningProviderId: text("planning_provider_id"),
  heartbeatEnabled: integer("heartbeat_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  providerId: text("provider_id").notNull(),
  createdBy: text("created_by").notNull(),
  budgetCents: integer("budget_cents"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const taskEvents = sqliteTable("task_events", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  projectId: text("project_id"),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  actionType: text("action_type").notNull(),
  risk: text("risk").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull(),
  approvedScope: text("approved_scope"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  source: text("source").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  suggestedActionsJson: text("suggested_actions_json").notNull(),
  createdAt: text("created_at").notNull(),
  // Stable key for deduplication and upsert. Format: "<projectId>:<checkId>"
  dedupeKey: text("dedupe_key"),
  firstSeenAt: text("first_seen_at"),
  lastSeenAt: text("last_seen_at"),
  seenCount: integer("seen_count").notNull().default(1),
});

export const providerConfigs = sqliteTable("provider_configs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  configJson: text("config_json").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const toolConfigs = sqliteTable("tool_configs", {
  id: text("id").primaryKey(),
  toolId: text("tool_id").notNull(),
  projectId: text("project_id"),
  configJson: text("config_json").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const heartbeatRuns = sqliteTable("heartbeat_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status").notNull(),
  summary: text("summary"),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  projectId: text("project_id"),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  sourceTaskId: text("source_task_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  providerId: text("provider_id"),
  projectId: text("project_id"),
  dailyLimitCents: integer("daily_limit_cents"),
  taskLimitCents: integer("task_limit_cents"),
  monthlyLimitCents: integer("monthly_limit_cents"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const costEvents = sqliteTable("cost_events", {
  id: text("id").primaryKey(),
  taskId: text("task_id"),
  projectId: text("project_id"),
  providerId: text("provider_id").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCents: integer("estimated_cents"),
  createdAt: text("created_at").notNull(),
});

export const panicLog = sqliteTable("panic_log", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  createdAt: text("created_at").notNull(),
});
