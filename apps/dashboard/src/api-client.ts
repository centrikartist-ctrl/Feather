import { FEATHER_BASE_URL } from "@feather/shared";

type DashboardEnv = {
  DEV?: boolean;
  VITE_FEATHER_API_BASE_URL?: string;
};

export function resolveApiBaseUrl(env: DashboardEnv): string {
  const override = env.VITE_FEATHER_API_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }
  return env.DEV ? FEATHER_BASE_URL : "";
}

export async function requestJson<T>(
  path: string,
  options: RequestInit | undefined,
  config: { apiBaseUrl: string; fetchImpl?: typeof fetch },
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBaseUrl = config.apiBaseUrl;
  const target = `${apiBaseUrl}${path}`;

  let response: Response;
  try {
    response = await fetchImpl(target, {
      ...options,
      headers: {
        ...(options?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
  } catch {
    throw new Error(`Feather daemon not reachable at ${apiBaseUrl || FEATHER_BASE_URL}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (looksLikeHtml(contentType, text)) {
    throw new Error("Expected JSON from Feather daemon but received HTML. Check VITE_FEATHER_API_BASE_URL or daemon status.");
  }

  let payload: unknown;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from Feather daemon but received ${contentType || "a non-JSON response"}.`);
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : response.statusText;
    throw new Error(message);
  }

  return payload as T;
}

function looksLikeHtml(contentType: string, text: string): boolean {
  if (contentType.includes("text/html")) {
    return true;
  }
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<body");
}