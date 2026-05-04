export const FEATHER_PORT = 47383;
export const FEATHER_HOST = "127.0.0.1";
export const FEATHER_BASE_URL = `http://${FEATHER_HOST}:${FEATHER_PORT}`;

export const FEATHER_CONFIG_DIR = ".feather";
export const FEATHER_AGENT_FILE = "agent.md";
export const FEATHER_PROJECT_CONFIG_FILE = "project.yml";
export const FEATHER_INSTRUCTIONS_FILE = "instructions.md";
export const FEATHER_HEARTBEAT_CONFIG_FILE = "heartbeat.yml";
export const FEATHER_BUDGET_CONFIG_FILE = "budget.yml";

export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 30;
export const DEFAULT_HEARTBEAT_QUIET_START = "22:30";
export const DEFAULT_HEARTBEAT_QUIET_END = "08:00";

export const SECRET_DENY_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  "secrets.*",
  "credentials.*",
  "*.p12",
  "*.pfx",
];

export const SHELL_DENY_PATTERNS = [
  "rm -rf *",
  "sudo *",
  "curl * | sh",
  "wget * | sh",
  "powershell Invoke-Expression *",
  "powershell iwr * | iex",
  "format *",
  "del /s *",
  "rmdir /s *",
];

export const ALWAYS_BLOCKED_PATHS = [".git", "node_modules"];

export const PERMISSION_SCOPES = [
  "filesystem:read",
  "filesystem:write",
  "shell:execute",
  "git:read",
  "git:write",
  "network:http",
  "network:telegram",
  "provider:send_context",
  "scheduler:create",
  "secrets:read",
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];
