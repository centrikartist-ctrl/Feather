import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import path from "node:path";
import fs from "node:fs";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(): DB {
  if (!_db) {
    throw new Error("Database not initialised. Call initDb() first.");
  }
  return _db;
}

export function initDb(dbPath: string): DB {
  closeDb();

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  runMigrations(_db, sqlite);
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
  }
  _db = null;
}

function runMigrations(db: DB, sqlite: Database.Database): void {
  // Run inline migrations for v0.1
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      default_provider_id TEXT,
      coding_provider_id TEXT,
      planning_provider_id TEXT,
      heartbeat_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      budget_cents INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      project_id TEXT,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      action_type TEXT NOT NULL,
      risk TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_scope TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      suggested_actions_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_configs (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      project_id TEXT,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeat_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      project_id TEXT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      provider_id TEXT,
      project_id TEXT,
      daily_limit_cents INTEGER,
      task_limit_cents INTEGER,
      monthly_limit_cents INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      project_id TEXT,
      provider_id TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      estimated_cents INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS panic_log (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_observations_project_id ON observations(project_id);
    CREATE INDEX IF NOT EXISTS idx_cost_events_task_id ON cost_events(task_id);
  `);

  ensureColumn(sqlite, "tasks", "budget_cents", "ALTER TABLE tasks ADD COLUMN budget_cents INTEGER");
  ensureColumn(sqlite, "observations", "dedupe_key", "ALTER TABLE observations ADD COLUMN dedupe_key TEXT");
  ensureColumn(sqlite, "observations", "first_seen_at", "ALTER TABLE observations ADD COLUMN first_seen_at TEXT");
  ensureColumn(sqlite, "observations", "last_seen_at", "ALTER TABLE observations ADD COLUMN last_seen_at TEXT");
  ensureColumn(sqlite, "observations", "seen_count", "ALTER TABLE observations ADD COLUMN seen_count INTEGER NOT NULL DEFAULT 1");
}

function ensureColumn(sqlite: Database.Database, tableName: string, columnName: string, addColumnSql: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    sqlite.exec(addColumnSql);
  }
}
