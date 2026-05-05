import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveProviderLocalApiKeyEnvName,
  getFeatherLocalSecretsPath,
  loadFeatherLocalSecrets,
  loadFeatherLocalSecretsIntoProcess,
  upsertFeatherLocalSecret,
} from "./index.js";

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feather-local-secrets-"));
  process.env["FEATHER_HOME_DIR"] = tempHome;
  delete process.env["TEST_SECRET_FROM_FILE"];
});

afterEach(() => {
  delete process.env["FEATHER_HOME_DIR"];
  delete process.env["TEST_SECRET_FROM_FILE"];
  delete process.env["EXISTING_SECRET"];
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("local Feather secrets", () => {
  it("upserts secrets without duplicating keys", () => {
    upsertFeatherLocalSecret("TEST_SECRET_FROM_FILE", "first");
    upsertFeatherLocalSecret("TEST_SECRET_FROM_FILE", "second");

    const contents = fs.readFileSync(getFeatherLocalSecretsPath(), "utf8");
    expect(contents.match(/TEST_SECRET_FROM_FILE=/g)).toHaveLength(1);
    expect(loadFeatherLocalSecrets()).toMatchObject({ TEST_SECRET_FROM_FILE: "second" });
  });

  it("fills missing process env values from the local secrets file only", () => {
    fs.writeFileSync(getFeatherLocalSecretsPath(), 'TEST_SECRET_FROM_FILE="local"\nEXISTING_SECRET="local-override"\n', "utf8");
    process.env["EXISTING_SECRET"] = "shell";

    const loaded = loadFeatherLocalSecretsIntoProcess();

    expect(loaded).toContain("TEST_SECRET_FROM_FILE");
    expect(process.env["TEST_SECRET_FROM_FILE"]).toBe("local");
    expect(process.env["EXISTING_SECRET"]).toBe("shell");
  });

  it("derives stable provider env names for pasted keys", () => {
    expect(deriveProviderLocalApiKeyEnvName("openai-compatible", "primary provider")).toBe(
      "FEATHER_OPENAI_COMPATIBLE_PRIMARY_PROVIDER_API_KEY",
    );
  });
});
