import type { ProviderAdapter } from "./adapter.js";
import type {
  ProviderCapabilities,
  ProviderHealth,
  TaskInput,
  ProviderEvent,
} from "@feather/shared";

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  maxTaskCents?: number;
  organizationId?: string;
  /** Pricing for cost estimation. If absent, estimatedCents will not be calculated. */
  inputCentsPer1MTokens?: number;
  outputCentsPer1MTokens?: number;
};

export function calculateEstimatedCents(
  usage: { inputTokens?: number; outputTokens?: number },
  pricing: { inputCentsPer1MTokens?: number; outputCentsPer1MTokens?: number },
): number | undefined {
  const inputCentsPer1M = pricing.inputCentsPer1MTokens;
  const outputCentsPer1M = pricing.outputCentsPer1MTokens;
  if (inputCentsPer1M === undefined || outputCentsPer1M === undefined) {
    return undefined;
  }

  const inputTok = usage.inputTokens ?? 0;
  const outputTok = usage.outputTokens ?? 0;
  return Math.ceil(
    (inputTok / 1_000_000) * inputCentsPer1M +
    (outputTok / 1_000_000) * outputCentsPer1M,
  );
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  id: string;
  name: string;
  type = "openai-compatible";
  capabilities: ProviderCapabilities = {
    streaming: true,
    // Feather currently handles tool execution internally; OpenAI-compatible providers do not expose native tool-calling yet.
    toolCalling: false,
    coding: true,
    reasoning: false,
    costEstimate: true,
    supportsProjectRoot: false,
    // Will be overridden in constructor based on whether pricing is configured.
    costEnforcementMode: "unknown",
  };
  private activeTasks = new Map<string, AbortController>();

  constructor(
    id: string,
    name: string,
    private readonly config: OpenAICompatibleConfig,
  ) {
    this.id = id;
    this.name = name;
    // Honest capability: only claim "estimated" if pricing fields are present.
    if (config.inputCentsPer1MTokens !== undefined && config.outputCentsPer1MTokens !== undefined) {
      this.capabilities = { ...this.capabilities, costEnforcementMode: "estimated" };
    }
  }

  private getApiKey(): string | null {
    return process.env[this.config.apiKeyEnv] ?? null;
  }

  async validateConfig(): Promise<ProviderHealth> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        ok: false,
        message: `API key not found. Set environment variable: ${this.config.apiKeyEnv}`,
      };
    }

    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(this.config.organizationId ? { "OpenAI-Organization": this.config.organizationId } : {}),
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        return { ok: false, message: `Provider returned ${res.status}: ${await res.text()}` };
      }

      return { ok: true, message: `Connected to ${this.config.baseUrl} with model ${this.config.model}` };
    } catch (err) {
      return { ok: false, message: `Connection failed: ${String(err)}` };
    }
  }

  async *startTask(input: TaskInput): AsyncIterable<ProviderEvent> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      yield { type: "error", error: `API key not found. Set ${this.config.apiKeyEnv}` };
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    this.activeTasks.set(input.taskId, controller);

    // P3: Bridge external signal so TaskRunner cancellation propagates into the fetch.
    const onExternalAbort = (): void => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    } else {
      input.signal?.addEventListener("abort", onExternalAbort, { once: true });
    }

    const messages: Array<{ role: string; content: string }> = [];

    if (input.systemPrompt) {
      messages.push({ role: "system", content: input.systemPrompt });
    }

    if (input.contextFiles && input.contextFiles.length > 0) {
      const contextBlock = input.contextFiles
        .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      messages.push({
        role: "system",
        content: `Relevant context files:\n\n${contextBlock}`,
      });
    }

    messages.push({ role: "user", content: input.prompt });

    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(this.config.organizationId ? { "OpenAI-Organization": this.config.organizationId } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
          // P7: Request token usage in the stream so we can do accurate budget enforcement.
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        yield { type: "error", error: `Provider returned ${res.status}: ${await res.text()}` };
        return;
      }

      if (!res.body) {
        yield { type: "error", error: "No response body from provider" };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let summary = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              summary += delta;
              yield { type: "text_delta", text: delta };
            }

            if (parsed.usage) {
              const estimatedCents = calculateEstimatedCents(
                {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                },
                this.config,
              );
              yield {
                type: "cost_estimate",
                inputTokens: parsed.usage.prompt_tokens,
                outputTokens: parsed.usage.completion_tokens,
                ...(estimatedCents !== undefined ? { estimatedCents } : {}),
              };
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      yield { type: "done", summary: summary.slice(0, 500) || "Task completed." };
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      yield { type: "error", error: `Request failed: ${String(err)}` };
    } finally {
      input.signal?.removeEventListener("abort", onExternalAbort);
      clearTimeout(timeout);
      this.activeTasks.delete(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    this.activeTasks.get(taskId)?.abort();
  }
}

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(id: string, config: Omit<OpenAICompatibleConfig, "baseUrl"> & { baseUrl?: string }) {
    super(id, `OpenAI (${id})`, {
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      ...config,
    });
    this.type = "openai";
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(id: string, config: Omit<OpenAICompatibleConfig, "baseUrl"> & { baseUrl?: string }) {
    super(id, `OpenRouter (${id})`, {
      baseUrl: config.baseUrl ?? "https://openrouter.ai/api/v1",
      ...config,
    });
    this.type = "openrouter";
  }
}
