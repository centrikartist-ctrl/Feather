import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider, parseFeatherToolRequest } from "./openai-compatible.js";

describe("provider validation failure", () => {
  it("fails validation when the configured API key env var is missing", async () => {
    const provider = new OpenAICompatibleProvider("missing-key", "Missing Key", {
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "FEATHER_TEST_MISSING_API_KEY",
      model: "gpt-5.4",
    });

    const health = await provider.validateConfig();
    expect(health.ok).toBe(false);
    expect(health.message).toContain("FEATHER_TEST_MISSING_API_KEY");
  });

  it("parses a feather_tool block into a tool request", () => {
    expect(parseFeatherToolRequest([
      "```feather_tool",
      '{"toolName":"filesystem.writeFile","input":{"path":"docs/smoke.txt","content":"ok"}}',
      "```",
    ].join("\n"))).toEqual({
      toolName: "filesystem.writeFile",
      input: {
        path: "docs/smoke.txt",
        content: "ok",
      },
    });
  });

  it("ignores normal prose responses", () => {
    expect(parseFeatherToolRequest("I created the file for you.")).toBeNull();
  });
});