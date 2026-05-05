export type GatewayHealthStatus = "healthy" | "degraded" | "critical" | "maintenance" | "safe_mode";

export type GatewayHealth = {
  status: GatewayHealthStatus;
  version?: string;
  bootId?: string;
  uptimeMs?: number;
  checks?: Record<string, string>;
  panicLockActive?: boolean;
  maintenanceMode?: boolean;
};

export type HealthPollResult =
  | { reachable: true; health: GatewayHealth; diagnostic?: NoopDiagnostic }
  | { reachable: false; error: string };

export type NoopDiagnostic = {
  diagnosticId: string;
  result: "pass" | "fail";
  checks: Record<string, string>;
};

export type HealthClassification = "healthy" | "degraded" | "critical" | "maintenance" | "safe_mode" | "unreachable";

export function classifyHealth(result: HealthPollResult): HealthClassification {
  if (!result.reachable) return "unreachable";
  if (result.health.status === "safe_mode") return "safe_mode";
  if (result.health.status === "maintenance") return "maintenance";
  if (result.health.status === "critical") return "critical";
  if (result.diagnostic?.result === "fail") return "critical";
  if (result.health.status === "degraded") return "degraded";
  return "healthy";
}

export async function pollGatewayHealth(gatewayUrl: string, timeoutMs: number, runDiagnostic: boolean): Promise<HealthPollResult> {
  try {
    const health = await fetchJson<GatewayHealth>(`${gatewayUrl}/health`, timeoutMs);
    const diagnostic = runDiagnostic
      ? await fetchJson<NoopDiagnostic>(`${gatewayUrl}/diagnostics/noop`, timeoutMs, { method: "POST" })
      : undefined;
    return { reachable: true, health, ...(diagnostic ? { diagnostic } : {}) };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchJson<T>(url: string, timeoutMs: number, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
