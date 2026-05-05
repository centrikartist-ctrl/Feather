import fs from "node:fs";
import path from "node:path";
import { FEATHER_BASE_URL } from "@feather/shared";
import { getFeatherHomeDir, getLifecycleRequestsDir } from "@feather/core";

export type SupervisorConfig = {
  gatewayUrl: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  restartFailureThreshold: number;
  safeModeFailureThreshold: number;
  restart: {
    enabled: boolean;
    command?: string;
    args: string[];
    cwd?: string;
  };
  featherHomeDir: string;
  snapshotsDir: string;
  requestsDir: string;
};

type ConfigFile = Partial<Omit<SupervisorConfig, "restart">> & {
  restart?: Partial<SupervisorConfig["restart"]>;
};

export function loadSupervisorConfig(configPath = process.env["FEATHER_SUPERVISOR_CONFIG"]): SupervisorConfig {
  const featherHomeDir = getFeatherHomeDir();
  const fileConfig = configPath && fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigFile
    : {};
  const restartConfig = fileConfig.restart ?? {};

  return {
    gatewayUrl: process.env["FEATHER_GATEWAY_URL"] ?? fileConfig.gatewayUrl ?? FEATHER_BASE_URL,
    pollIntervalMs: readPositiveInt(process.env["FEATHER_SUPERVISOR_POLL_MS"], fileConfig.pollIntervalMs, 30_000),
    requestTimeoutMs: readPositiveInt(process.env["FEATHER_SUPERVISOR_TIMEOUT_MS"], fileConfig.requestTimeoutMs, 5_000),
    restartFailureThreshold: readPositiveInt(process.env["FEATHER_SUPERVISOR_RESTART_FAILURES"], fileConfig.restartFailureThreshold, 2),
    safeModeFailureThreshold: readPositiveInt(process.env["FEATHER_SUPERVISOR_SAFE_MODE_FAILURES"], fileConfig.safeModeFailureThreshold, 5),
    restart: {
      enabled: process.env["FEATHER_SUPERVISOR_RESTART_ENABLED"] === "true" || restartConfig.enabled === true,
      command: process.env["FEATHER_GATEWAY_COMMAND"] ?? restartConfig.command,
      args: process.env["FEATHER_GATEWAY_ARGS"]
        ? process.env["FEATHER_GATEWAY_ARGS"].split(" ").filter(Boolean)
        : restartConfig.args ?? [],
      cwd: process.env["FEATHER_GATEWAY_CWD"] ?? restartConfig.cwd,
    },
    featherHomeDir,
    snapshotsDir: fileConfig.snapshotsDir ?? path.join(featherHomeDir, "snapshots"),
    requestsDir: fileConfig.requestsDir ?? getLifecycleRequestsDir(),
  };
}

function readPositiveInt(envValue: string | undefined, fileValue: number | undefined, fallback: number): number {
  const value = envValue ? Number.parseInt(envValue, 10) : fileValue;
  if (value === undefined) {
    return fallback;
  }
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
