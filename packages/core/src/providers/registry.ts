import type { ProviderAdapter } from "./adapter.js";
import { CodexCliProvider } from "./codex-cli.js";
import { OpenAICompatibleProvider, OpenAIProvider, OpenRouterProvider } from "./openai-compatible.js";
import { ValidationError } from "@feather/shared";

export type ProviderConfigEntry =
  | {
      id: string;
      type: "codex-cli";
      command?: string;
      mode?: "exec" | "apply";
    }
  | {
      id: string;
      type: "openai";
      apiKeyEnv: string;
      credentialMode?: "env" | "local";
      model: string;
      maxTaskCents?: number;
      baseUrl?: string;
      inputCentsPer1MTokens?: number;
      outputCentsPer1MTokens?: number;
    }
  | {
      id: string;
      type: "openai-compatible";
      baseUrl: string;
      apiKeyEnv: string;
      credentialMode?: "env" | "local";
      model: string;
      maxTaskCents?: number;
      inputCentsPer1MTokens?: number;
      outputCentsPer1MTokens?: number;
    }
  | {
      id: string;
      type: "openrouter";
      apiKeyEnv: string;
      credentialMode?: "env" | "local";
      model: string;
      maxTaskCents?: number;
      inputCentsPer1MTokens?: number;
      outputCentsPer1MTokens?: number;
    };

export class ProviderRegistry {
  private providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  clear(): void {
    this.providers.clear();
  }

  get(id: string): ProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ValidationError(`Provider not found: ${id}`);
    }
    return provider;
  }

  list(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  fromConfig(config: ProviderConfigEntry): ProviderAdapter {
    switch (config.type) {
      case "codex-cli":
        return new CodexCliProvider(config.id, { command: config.command });
      case "openai":
        return new OpenAIProvider(config.id, {
          apiKeyEnv: config.apiKeyEnv,
          model: config.model,
          maxTaskCents: config.maxTaskCents,
          baseUrl: config.baseUrl,
          inputCentsPer1MTokens: config.inputCentsPer1MTokens,
          outputCentsPer1MTokens: config.outputCentsPer1MTokens,
        });
      case "openai-compatible":
        return new OpenAICompatibleProvider(config.id, `OpenAI-compatible (${config.id})`, {
          baseUrl: config.baseUrl,
          apiKeyEnv: config.apiKeyEnv,
          model: config.model,
          maxTaskCents: config.maxTaskCents,
          inputCentsPer1MTokens: config.inputCentsPer1MTokens,
          outputCentsPer1MTokens: config.outputCentsPer1MTokens,
        });
      case "openrouter":
        return new OpenRouterProvider(config.id, {
          apiKeyEnv: config.apiKeyEnv,
          model: config.model,
          maxTaskCents: config.maxTaskCents,
          inputCentsPer1MTokens: config.inputCentsPer1MTokens,
          outputCentsPer1MTokens: config.outputCentsPer1MTokens,
        });
      default: {
        const _exhaustive: never = config;
        throw new ValidationError(`Unknown provider type: ${(_exhaustive as ProviderConfigEntry).type}`);
      }
    }
  }
}
