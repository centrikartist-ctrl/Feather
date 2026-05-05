import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, loadGlobalConfig, saveGlobalConfig } from "@feather/core";
import { formatDoctorReport, renderCommandsGuide, runDoctor, runSetupBootstrap } from "./lib.js";

let tempDir: string;

describe("CLI helpers", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-cli-test-"));
    process.env["FEATHER_HOME_DIR"] = path.join(tempDir, "home");
  });

  afterEach(() => {
    closeDb();
    delete process.env["FEATHER_HOME_DIR"];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders a grouped commands guide with the supported alpha commands", () => {
    const text = renderCommandsGuide();

    expect(text).toContain("feather setup");
    expect(text).toContain("feather doctor");
    expect(text).toContain("feather projects");
    expect(text).toContain("pnpm --filter @feather/supervisor exec tsx src/main.ts status");
  });

  it("bootstraps Feather home, config, agent profile, and database without secrets", async () => {
    const result = await runSetupBootstrap();

    expect(fs.existsSync(result.featherHomeDir)).toBe(true);
    expect(fs.existsSync(result.configPath)).toBe(true);
    expect(fs.existsSync(result.agentPath)).toBe(true);
    expect(fs.existsSync(result.dbPath)).toBe(true);
    const configContent = fs.readFileSync(result.configPath, "utf8");
    expect(configContent).not.toContain("telegramBotToken");
  });

  it("reports missing providers and projects clearly", async () => {
    await runSetupBootstrap();

    const result = await runDoctor({
      getPnpmVersion: async () => "9.0.0",
      fetchJson: async () => {
        throw new Error("offline");
      },
    });

    const providerCheck = result.checks.find((check) => check.label === "Providers");
    const projectCheck = result.checks.find((check) => check.label === "Projects");

    expect(providerCheck?.status).toBe("warn");
    expect(providerCheck?.detail).toContain("No providers configured yet");
    expect(projectCheck?.status).toBe("warn");
    expect(projectCheck?.detail).toContain("No projects registered yet");
  });

  it("does not print Telegram secrets in doctor output", async () => {
    await runSetupBootstrap();
    const config = loadGlobalConfig();
    config.telegramBotToken = "super-secret-token";
    config.allowedTelegramUserIds = [123];
    saveGlobalConfig(config);

    const result = await runDoctor({
      getPnpmVersion: async () => "9.0.0",
      fetchJson: async () => {
        throw new Error("offline");
      },
    });
    const output = formatDoctorReport(result);

    expect(output).toContain("Telegram: Configured");
    expect(output).not.toContain("super-secret-token");
  });
});