import { describe, expect, it } from "vitest";
import { MAX_TOOL_INPUT_JSON_CHARS, OpenAICompatibleProvider, parseFeatherToolRequest } from "./openai-compatible.js";

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

  it("rejects malformed JSON", () => {
    expect(parseFeatherToolRequest(["```feather_tool", "{not-json}", "```"].join("\n"))).toBeNull();
  });

  it("rejects missing tool names", () => {
    expect(parseFeatherToolRequest(["```feather_tool", '{"input":{"path":"docs/smoke.txt"}}', "```"].join("\n"))).toBeNull();
  });

  it("rejects unknown tool names", () => {
    expect(parseFeatherToolRequest(["```feather_tool", '{"toolName":"filesystem.deleteAll","input":{}}', "```"].join("\n"))).toBeNull();
  });

  it("rejects oversized tool input", () => {
    const hugeContent = "x".repeat(MAX_TOOL_INPUT_JSON_CHARS + 1);
    expect(parseFeatherToolRequest(["```feather_tool", JSON.stringify({ toolName: "filesystem.writeFile", input: { path: "docs/smoke.txt", content: hugeContent } }), "```"].join("\n"))).toBeNull();
  });

  it("rejects multiple tool blocks", () => {
    expect(parseFeatherToolRequest([
      "```feather_tool",
      '{"toolName":"filesystem.readFile","input":{"path":"README.md"}}',
      "```",
      "```feather_tool",
      '{"toolName":"filesystem.readFile","input":{"path":"docs/alpha.md"}}',
      "```",
    ].join("\n"))).toBeNull();
  });

  it("rejects extra prose around a tool block", () => {
    expect(parseFeatherToolRequest(["I will do it.", "```feather_tool", '{"toolName":"filesystem.readFile","input":{"path":"README.md"}}', "```"].join("\n"))).toBeNull();
  });
});