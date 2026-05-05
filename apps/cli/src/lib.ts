import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ProviderConfigService,
  ProviderRegistry,
  ProjectService,
  closeDb,
  getFeatherHomeDir,
  getGlobalAgentFilePath,
  getGlobalConfigPath,
  initDb,
  initGlobalAgentFile,
  loadGlobalConfig,
  saveGlobalConfig,
} from "@feather/core";

const execFileAsync = promisify(execFile);
const SUPPORTED_NODE_MIN = 20;
const SUPPORTED_NODE_MAX = 24;

export type DoctorCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

export type DoctorResult = {
  checks: DoctorCheck[];
  exitCode: number;
};

export type SetupResult = {
  featherHomeDir: string;
  configPath: string;
  agentPath: string;
  dbPath: string;
  createdConfig: boolean;
  createdAgent: boolean;
  createdDb: boolean;
};

type DoctorOptions = {
  fetchJson?: (path: string, options?: RequestInit) => Promise<unknown>;
  getPnpmVersion?: () => Promise<string>;
  fileExists?: (filePath: string) => boolean;
  nodeVersion?: string;
  repoRoot?: string;
};

export function renderCommandsGuide(): string {
  return [
    "Feather commands",
    "",
    "Setup:",
    "  feather setup",
    "  feather doctor",
    "  feather commands",
    "",
    "Daemon:",
    "  feather daemon start",
    "  feather daemon stop",
    "  feather status",
    "  feather dashboard",
    "",
    "Projects:",
    "  feather init",
    "  feather project add <path>",
    "  feather project list",
    "  feather projects",
    "  feather project recap <name>",
    "",
    "Tasks:",
    "  feather task <project> <prompt>",
    "  feather approvals",
    "  feather approve <id>",
    "  feather reject <id>",
    "",
    "Providers:",
    "  feather provider list",
    "  feather provider test <id>",
    "  feather budget status",
    "",
    "Safety:",
    "  feather panic",
    "  feather resume",
    "  feather heartbeat run",
    "",
    "Guard:",
    "  pnpm --filter @feather/supervisor exec tsx src/main.ts status",
    "  pnpm --filter @feather/supervisor exec tsx src/main.ts snapshot create \"manual\"",
  ].join("\n");
}

export async function runSetupBootstrap(): Promise<SetupResult> {
  const featherHomeDir = getFeatherHomeDir();
  const configPath = getGlobalConfigPath();
  const agentPath = getGlobalAgentFilePath();
  const configExisted = fs.existsSync(configPath);
  const agentExisted = fs.existsSync(agentPath);

  const config = loadGlobalConfig();
  saveGlobalConfig(config);
  initGlobalAgentFile();

  const dbExisted = fs.existsSync(config.dbPath);
  initDb(config.dbPath);
  closeDb();

  return {
    featherHomeDir,
    configPath,
    agentPath,
    dbPath: config.dbPath,
    createdConfig: !configExisted,
    createdAgent: !agentExisted,
    createdDb: !dbExisted,
  };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const getPnpmVersion = options.getPnpmVersion ?? defaultGetPnpmVersion;
  const fileExists = options.fileExists ?? fs.existsSync;
  const nodeVersion = options.nodeVersion ?? process.version;
  const repoRoot = options.repoRoot ?? path.resolve(path.join(import.meta.dirname, "../../.."));

  const checks: DoctorCheck[] = [];
  const featherHomeDir = getFeatherHomeDir();
  const configPath = getGlobalConfigPath();
  const agentPath = getGlobalAgentFilePath();
  const nodeStatus = getNodeSupport(nodeVersion);

  checks.push({
    label: "Node.js",
    status: nodeStatus.supported ? "ok" : "fail",
    detail: nodeStatus.supported
      ? `${nodeVersion} supported for Feather alpha`
      : `${nodeVersion} is outside the supported range >=${SUPPORTED_NODE_MIN} <${SUPPORTED_NODE_MAX + 1}`,
  });

  try {
    const pnpmVersion = await getPnpmVersion();
    checks.push({ label: "pnpm", status: "ok", detail: `pnpm ${pnpmVersion}` });
  } catch (error) {
    checks.push({
      label: "pnpm",
      status: "warn",
      detail: `Could not determine pnpm version: ${formatError(error)}`,
    });
  }

  checks.push({
    label: "Feather home",
    status: fileExists(featherHomeDir) ? "ok" : "warn",
    detail: fileExists(featherHomeDir)
      ? `Found ${featherHomeDir}`
      : `Missing ${featherHomeDir}. Run feather setup.`,
  });

  checks.push({
    label: "Global config",
    status: fileExists(configPath) ? "ok" : "warn",
    detail: fileExists(configPath)
      ? `Found ${configPath}`
      : `Missing ${configPath}. Run feather setup.`,
  });

  checks.push({
    label: "Agent profile",
    status: fileExists(agentPath) ? "ok" : "warn",
    detail: fileExists(agentPath)
      ? `Found ${agentPath}`
      : `Missing ${agentPath}. Run feather setup.`,
  });

  const config = loadGlobalConfig();
  try {
    const dbExisted = fileExists(config.dbPath);
    initDb(config.dbPath);
    const providers = new ProviderConfigService(new ProviderRegistry());
    const projects = new ProjectService();
    const [providerList, projectList] = await Promise.all([providers.list(), projects.listProjects()]);
    closeDb();

    checks.push({
      label: "Database",
      status: "ok",
      detail: dbExisted ? `Reachable at ${config.dbPath}` : `Initialised at ${config.dbPath}`,
    });
    checks.push({
      label: "Providers",
      status: providerList.length > 0 ? "ok" : "warn",
      detail: providerList.length > 0
        ? `${providerList.length} provider${providerList.length === 1 ? "" : "s"} configured`
        : "No providers configured yet. Add one in the dashboard or onboarding.",
    });
    checks.push({
      label: "Projects",
      status: projectList.length > 0 ? "ok" : "warn",
      detail: projectList.length > 0
        ? `${projectList.length} project${projectList.length === 1 ? "" : "s"} registered`
        : "No projects registered yet. Add one in the dashboard or with feather project add <path>.",
    });
  } catch (error) {
    closeDb();
    checks.push({ label: "Database", status: "fail", detail: formatError(error) });
  }

  let daemonReachable = false;
  try {
    const health = await fetchJson("/health") as { status?: string; version?: string };
    daemonReachable = true;
    const healthStatus = health.status ?? "unknown";
    checks.push({
      label: "Daemon health",
      status: healthStatus === "critical" ? "fail" : "ok",
      detail: `Reachable via /health${health.version ? ` (v${health.version})` : ""}; status=${healthStatus}`,
    });
  } catch (error) {
    checks.push({
      label: "Daemon health",
      status: "warn",
      detail: `Daemon not reachable. Start Feather to run /health checks. (${formatError(error)})`,
    });
  }

  if (daemonReachable) {
    try {
      const diagnostic = await fetchJson("/diagnostics/noop", { method: "POST" }) as { result?: string };
      const result = diagnostic.result ?? "unknown";
      checks.push({
        label: "No-op diagnostic",
        status: result === "pass" ? "ok" : "fail",
        detail: `POST /diagnostics/noop returned ${result}`,
      });
    } catch (error) {
      checks.push({ label: "No-op diagnostic", status: "fail", detail: formatError(error) });
    }
  } else {
    checks.push({
      label: "No-op diagnostic",
      status: "warn",
      detail: "Skipped because the daemon is not running.",
    });
  }

  const telegramConfigured = Boolean(config.telegramBotToken?.trim()) && Boolean(config.allowedTelegramUserIds?.length);
  checks.push({
    label: "Telegram",
    status: telegramConfigured ? "ok" : "warn",
    detail: telegramConfigured ? "Configured" : "Not configured. This is optional for alpha.",
  });

  const supervisorPackagePath = path.join(repoRoot, "apps", "supervisor", "package.json");
  const supervisorEntryPath = path.join(repoRoot, "apps", "supervisor", "src", "main.ts");
  checks.push({
    label: "Guard supervisor",
    status: fileExists(supervisorPackagePath) && fileExists(supervisorEntryPath) ? "ok" : "warn",
    detail: fileExists(supervisorPackagePath) && fileExists(supervisorEntryPath)
      ? "Supervisor package and entrypoint are present."
      : "Supervisor package is missing or incomplete.",
  });

  const exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
  return { checks, exitCode };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines = ["Feather doctor", ""];
  for (const check of result.checks) {
    lines.push(`${statusIcon(check.status)} ${check.label}: ${check.detail}`);
  }
  return lines.join("\n");
}

function statusIcon(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":
      return "OK";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
  }
}

function getNodeSupport(nodeVersion: string): { supported: boolean; major: number | null } {
  const match = nodeVersion.match(/(\d+)/);
  const major = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(major)) {
    return { supported: false, major: null };
  }
  return { supported: major >= SUPPORTED_NODE_MIN && major <= SUPPORTED_NODE_MAX, major };
}

async function defaultGetPnpmVersion(): Promise<string> {
  const { stdout } = await execFileAsync("pnpm", ["--version"], { windowsHide: true });
  return stdout.trim();
}

async function defaultFetchJson(pathname: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:47383${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? response.statusText);
  }
  return response.json();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}