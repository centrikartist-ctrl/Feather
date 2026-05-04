import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { ProviderRegistry } from "./registry.js";
import { ProviderConfigService } from "./service.js";
import { OpenAICompatibleProvider, calculateEstimatedCents } from "./openai-compatible.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-provider-pricing-test-"));
  initDb(path.join(tempDir, "test.db"));
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("provider pricing configuration", () => {
  it("persists pricing and constructs providers with estimated mode", async () => {
    const registry = new ProviderRegistry();
    const service = new ProviderConfigService(registry);

    const saved = await service.upsert({
      id: "priced-openai",
      name: "Priced OpenAI",
      type: "openai",
      config: {
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-5.4-mini",
        baseUrl: "https://api.openai.com/v1",
        inputCentsPer1MTokens: 250,
        outputCentsPer1MTokens: 750,
      },
    });

    expect(saved.config).toMatchObject({
      inputCentsPer1MTokens: 250,
      outputCentsPer1MTokens: 750,
    });
    expect(registry.get("priced-openai").capabilities.costEnforcementMode).toBe("estimated");
  });

  it("constructs providers without pricing in unknown cost mode", async () => {
    const registry = new ProviderRegistry();
    const service = new ProviderConfigService(registry);

    await service.upsert({
      id: "unpriced-openrouter",
      name: "Unpriced OpenRouter",
      type: "openrouter",
      config: {
        apiKeyEnv: "OPENROUTER_API_KEY",
        model: "openrouter/small",
      },
    });

    expect(registry.get("unpriced-openrouter").capabilities.costEnforcementMode).toBe("unknown");
  });
});

describe("OpenAICompatibleProvider pricing estimation", () => {
  it("calculates estimated cents when pricing is configured", () => {
    expect(calculateEstimatedCents(
      { inputTokens: 400_000, outputTokens: 200_000 },
      { inputCentsPer1MTokens: 250, outputCentsPer1MTokens: 750 },
    )).toBe(250);
  });

  it("returns undefined estimated cents when pricing is missing", () => {
    expect(calculateEstimatedCents(
      { inputTokens: 400_000, outputTokens: 200_000 },
      { inputCentsPer1MTokens: 250 },
    )).toBeUndefined();
  });

  it("reports unknown cost mode when pricing is absent", () => {
    const provider = new OpenAICompatibleProvider("missing-pricing", "Missing Pricing", {
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-5.4-mini",
    });

    expect(provider.capabilities.costEnforcementMode).toBe("unknown");
  });
});