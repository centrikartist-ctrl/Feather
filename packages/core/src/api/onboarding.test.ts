import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDaemon } from "../daemon.js";
import { closeDb } from "../db/index.js";
import { _resetPanicForTesting } from "../panic/index.js";
import { getFeatherLocalSecretsPath } from "../secrets/index.js";

const tempDirs: string[] = [];

beforeEach(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "feather-onboarding-api-home-"));
  process.env["FEATHER_HOME_DIR"] = home;
  tempDirs.push(home);
  _resetPanicForTesting();
});

afterEach(() => {
  closeDb();
  _resetPanicForTesting();
  delete process.env["FEATHER_HOME_DIR"];
  delete process.env["TELEGRAM_BOT_TOKEN"];
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("FEATHER_OPENAI_")) {
      delete process.env[key];
    }
  }
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("onboarding and provider secret handling", () => {
  it("stores pasted provider keys locally and validates without shell env setup", async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-provider-api-db-"));
    tempDirs.push(dbDir);
    const daemon = await startDaemon({ port: 0, dbPath: path.join(dbDir, "test.db") });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const create = await daemon.app.inject({
        method: "POST",
        url: "/providers",
        payload: {
          id: "primary",
          name: "Primary Provider",
          type: "openai",
          credentialMode: "local",
          apiKeyValue: "sk-local-test",
          model: "gpt-4o-mini",
        },
      });

      expect(create.statusCode).toBe(200);

      const secretsContents = fs.readFileSync(getFeatherLocalSecretsPath(), "utf8");
      expect(secretsContents).toContain("FEATHER_OPENAI_PRIMARY_API_KEY");
      expect(secretsContents).toContain("sk-local-test");

      const list = await daemon.app.inject({ method: "GET", url: "/providers" });
      expect(list.statusCode).toBe(200);
      expect(list.json().providers[0].config).toMatchObject({
        credentialMode: "local",
        apiKeyEnv: "FEATHER_OPENAI_PRIMARY_API_KEY",
        apiKeyStoredLocally: true,
      });
      expect(JSON.stringify(list.json())).not.toContain("sk-local-test");

      const validate = await daemon.app.inject({ method: "POST", url: "/providers/primary/validate" });
      expect(validate.statusCode).toBe(200);
      expect(validate.json().health.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestInit = fetchMock.mock.calls[0]?.[1];
      expect(new Headers(requestInit?.headers).get("Authorization")).toBe("Bearer sk-local-test");
    } finally {
      await daemon.app.close();
    }
  });

  it("stores Telegram tokens in local secrets instead of config.yml", async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-telegram-api-db-"));
    tempDirs.push(dbDir);
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feather-project-root-"));
    tempDirs.push(projectRoot);
    const daemon = await startDaemon({ port: 0, dbPath: path.join(dbDir, "test.db") });

    try {
      const response = await daemon.app.inject({
        method: "POST",
        url: "/onboarding/machine-setup",
        payload: {
          provider: {
            id: "codex",
            name: "Codex CLI",
            type: "codex-cli",
            command: "codex",
          },
          project: {
            name: "Example Project",
            rootPath: projectRoot,
            codingProviderId: "codex",
          },
          telegram: {
            enabled: true,
            botToken: "123:telegram-test-token",
            allowedUserIds: [42],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const configPath = path.join(process.env["FEATHER_HOME_DIR"]!, "config.yml");
      const configContents = fs.readFileSync(configPath, "utf8");
      expect(configContents).not.toContain("123:telegram-test-token");
      expect(configContents).toContain("allowedTelegramUserIds");

      const secretsContents = fs.readFileSync(getFeatherLocalSecretsPath(), "utf8");
      expect(secretsContents).toContain("TELEGRAM_BOT_TOKEN");
      expect(secretsContents).toContain("123:telegram-test-token");
    } finally {
      await daemon.app.close();
    }
  });
});