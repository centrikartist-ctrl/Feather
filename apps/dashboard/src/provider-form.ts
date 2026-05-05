export type ProviderType = "codex-cli" | "openai" | "openai-compatible" | "openrouter";
export type ProviderCredentialMode = "env" | "local";

export type ProviderFormState = {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  command: string;
  mode: "exec" | "apply";
  credentialMode: ProviderCredentialMode;
  apiKeyEnv: string;
  apiKeyValue: string;
  apiKeyStoredLocally: boolean;
  model: string;
  baseUrl: string;
  maxTaskCents: string;
  inputCentsPer1MTokens: string;
  outputCentsPer1MTokens: string;
};

type ProviderSummary = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

const OPENAI_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-codex",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.5-pro",
];
const OPENROUTER_MODEL_OPTIONS = ["openai/gpt-4o-mini", "openai/gpt-4o", "openai/gpt-5.5", "anthropic/claude-3.5-sonnet"];

export function createDefaultProviderForm(): ProviderFormState {
  return {
    id: "",
    name: "",
    type: "openai",
    enabled: true,
    command: "codex",
    mode: "exec",
    credentialMode: "local",
    apiKeyEnv: getDefaultApiKeyEnv("openai"),
    apiKeyValue: "",
    apiKeyStoredLocally: false,
    model: getDefaultModel("openai"),
    baseUrl: getDefaultBaseUrl("openai"),
    maxTaskCents: "",
    inputCentsPer1MTokens: "",
    outputCentsPer1MTokens: "",
  };
}

export function applyProviderTypeDefaults(form: ProviderFormState, type: ProviderType): ProviderFormState {
  if (type === "codex-cli") {
    return {
      ...form,
      type,
      command: form.command || "codex",
      credentialMode: "local",
      apiKeyEnv: getDefaultApiKeyEnv(type),
      apiKeyValue: "",
      apiKeyStoredLocally: false,
      model: "",
      baseUrl: getDefaultBaseUrl(type),
    };
  }

  return {
    ...form,
    type,
    credentialMode: form.type === "codex-cli" ? "local" : form.credentialMode,
    apiKeyEnv: getDefaultApiKeyEnv(type),
    apiKeyValue: "",
    apiKeyStoredLocally: false,
    model: getDefaultModel(type),
    baseUrl: getDefaultBaseUrl(type),
  };
}

export function getProviderModelOptions(type: ProviderType): string[] {
  switch (type) {
    case "openai":
    case "openai-compatible":
      return OPENAI_MODEL_OPTIONS;
    case "openrouter":
      return OPENROUTER_MODEL_OPTIONS;
    case "codex-cli":
      return [];
  }
}

export function isCustomProviderModel(form: ProviderFormState): boolean {
  return form.type !== "codex-cli" && !getProviderModelOptions(form.type).includes(form.model);
}

export function isProviderFormValid(form: ProviderFormState): boolean {
  if (!form.id.trim() || !form.name.trim()) {
    return false;
  }

  if (form.type === "codex-cli") {
    return true;
  }

  if (!form.model.trim()) {
    return false;
  }

  if (form.credentialMode === "local") {
    return Boolean(form.apiKeyValue.trim() || form.apiKeyStoredLocally);
  }

  return Boolean(form.apiKeyEnv.trim());
}

export function serializeProviderForm(form: ProviderFormState): Record<string, unknown> {
  return {
    id: form.id,
    name: form.name,
    type: form.type,
    enabled: form.enabled,
    ...(form.type === "codex-cli"
      ? { command: form.command || undefined, mode: form.mode }
      : {
          credentialMode: form.credentialMode,
          ...(form.credentialMode === "env"
            ? { apiKeyEnv: form.apiKeyEnv }
            : {
                ...(form.apiKeyEnv ? { apiKeyEnv: form.apiKeyEnv } : {}),
                ...(form.apiKeyValue ? { apiKeyValue: form.apiKeyValue } : {}),
              }),
          model: form.model,
          ...(form.maxTaskCents ? { maxTaskCents: Number(form.maxTaskCents) } : {}),
          ...(form.inputCentsPer1MTokens ? { inputCentsPer1MTokens: Number(form.inputCentsPer1MTokens) } : {}),
          ...(form.outputCentsPer1MTokens ? { outputCentsPer1MTokens: Number(form.outputCentsPer1MTokens) } : {}),
          ...(form.type === "openai" || form.type === "openai-compatible" ? { baseUrl: form.baseUrl } : {}),
        }),
  };
}

export function providerToForm(provider: ProviderSummary): ProviderFormState {
  const type = provider.type as ProviderType;
  const credentialMode = provider.config.credentialMode === "env" ? "env" : "local";

  return {
    id: provider.id,
    name: provider.name,
    type,
    enabled: provider.enabled,
    command: typeof provider.config.command === "string" ? provider.config.command : "codex",
    mode: provider.config.mode === "apply" ? "apply" : "exec",
    credentialMode,
    apiKeyEnv: typeof provider.config.apiKeyEnv === "string" ? provider.config.apiKeyEnv : getDefaultApiKeyEnv(type),
    apiKeyValue: "",
    apiKeyStoredLocally: provider.config.apiKeyStoredLocally === true,
    model: typeof provider.config.model === "string" ? provider.config.model : getDefaultModel(type),
    baseUrl: typeof provider.config.baseUrl === "string" ? provider.config.baseUrl : getDefaultBaseUrl(type),
    maxTaskCents: typeof provider.config.maxTaskCents === "number" ? String(provider.config.maxTaskCents) : "",
    inputCentsPer1MTokens: typeof provider.config.inputCentsPer1MTokens === "number"
      ? String(provider.config.inputCentsPer1MTokens)
      : "",
    outputCentsPer1MTokens: typeof provider.config.outputCentsPer1MTokens === "number"
      ? String(provider.config.outputCentsPer1MTokens)
      : "",
  };
}

export function getProviderCredentialSummary(config: Record<string, unknown>): string {
  if (config.credentialMode === "local") {
    return "API key stored locally in ~/.feather/.env.local";
  }
  if (typeof config.apiKeyEnv === "string") {
    return `API key read from ${config.apiKeyEnv}`;
  }
  return "No API key reference configured.";
}

function getDefaultApiKeyEnv(type: ProviderType): string {
  switch (type) {
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "openai":
    case "openai-compatible":
      return "OPENAI_API_KEY";
    case "codex-cli":
      return "";
  }
}

function getDefaultModel(type: ProviderType): string {
  switch (type) {
    case "openrouter":
      return "openai/gpt-4o-mini";
    case "openai":
    case "openai-compatible":
      return "gpt-4o-mini";
    case "codex-cli":
      return "";
  }
}

function getDefaultBaseUrl(type: ProviderType): string {
  switch (type) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "openai":
    case "openai-compatible":
      return "https://api.openai.com/v1";
    case "codex-cli":
      return "";
  }
}