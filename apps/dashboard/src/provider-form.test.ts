import { describe, expect, it } from "vitest";
import {
  applyProviderTypeDefaults,
  createDefaultProviderForm,
  getProviderModelOptions,
  isProviderFormValid,
  providerToForm,
  serializeProviderForm,
} from "./provider-form.js";

describe("provider form helpers", () => {
  it("defaults api providers to local credential mode and gpt-4o-mini", () => {
    const form = createDefaultProviderForm();
    expect(form.type).toBe("openai");
    expect(form.credentialMode).toBe("local");
    expect(form.model).toBe("gpt-4o-mini");
    expect(getProviderModelOptions("openai")).toContain("gpt-5");
    expect(getProviderModelOptions("openai")).toContain("gpt-5.4");
    expect(getProviderModelOptions("openai")).toContain("gpt-5.5");
  });

  it("serializes local credential mode without forcing an env var input", () => {
    const form = {
      ...createDefaultProviderForm(),
      id: "primary",
      name: "Primary",
      apiKeyValue: "sk-test",
    };

    expect(serializeProviderForm(form)).toMatchObject({
      credentialMode: "local",
      apiKeyValue: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(isProviderFormValid(form)).toBe(true);
  });

  it("treats stored local credentials as valid when editing", () => {
    const form = providerToForm({
      id: "primary",
      name: "Primary",
      type: "openai",
      enabled: true,
      config: {
        credentialMode: "local",
        apiKeyEnv: "FEATHER_OPENAI_PRIMARY_API_KEY",
        apiKeyStoredLocally: true,
        model: "gpt-5.5",
      },
    });

    expect(form.apiKeyValue).toBe("");
    expect(isProviderFormValid(form)).toBe(true);
  });

  it("resets provider-specific defaults when switching types", () => {
    const form = applyProviderTypeDefaults(createDefaultProviderForm(), "codex-cli");
    expect(form.model).toBe("");
    expect(form.apiKeyEnv).toBe("");
  });
});