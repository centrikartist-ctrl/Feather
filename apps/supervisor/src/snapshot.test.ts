import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshot, isSafeSnapshotSource, redactSnapshotSecrets } from "./snapshot.js";

describe("snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("excludes secrets and redacts sensitive config lines", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "feather-supervisor-snapshot-"));
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(home, "config.yml"), [
      "telegramBotToken: should-not-copy",
      "OPENAI_API_KEY=should-not-copy",
      "API_KEY = should-not-copy",
      "\"apiKey\": \"should-not-copy\",",
      "password = should-not-copy",
      "secret: should-not-copy",
      "logLevel: info",
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(home, ".env.local"), "OPENAI_API_KEY=secret\n", "utf8");
    fs.writeFileSync(path.join(repo, "package.json"), "{\"name\":\"feather\"}\n", "utf8");

    const snapshot = createSnapshot({
      featherHomeDir: home,
      repoRoot: repo,
      snapshotsDir: path.join(root, "snapshots"),
      reason: "test",
      now: new Date("2026-05-05T12:00:00Z"),
    });

    expect(snapshot.ok).toBe(true);
    expect(fs.existsSync(path.join(snapshot.path, "home", ".env.local"))).toBe(false);
    const config = fs.readFileSync(path.join(snapshot.path, "home", "config.yml"), "utf8");
    expect(config).toContain("telegramBotToken: REDACTED");
    expect(config).toContain("OPENAI_API_KEY=REDACTED");
    expect(config).toContain("API_KEY = REDACTED");
    expect(config).toContain("\"apiKey\": \"REDACTED\",");
    expect(config).toContain("password = REDACTED");
    expect(config).toContain("secret: REDACTED");
    expect(config).not.toContain("should-not-copy");
    expect(snapshot.files).toContain("runtime/package.json");
    expect(snapshot.skipped).toEqual([]);
  });

  it("rejects unsafe snapshot sources", () => {
    expect(isSafeSnapshotSource("x/.env.local")).toBe(false);
    expect(isSafeSnapshotSource("x/node_modules/pkg/index.js")).toBe(false);
    expect(isSafeSnapshotSource("x/config.yml")).toBe(true);
  });

  it("redacts common secret assignment styles", () => {
    expect(redactSnapshotSecrets([
      "OPENAI_API_KEY=abc",
      "API_KEY = abc",
      "token: abc",
      "\"apiKey\": \"abc\",",
      "password = abc",
      "secret: abc",
    ].join("\n"))).toBe([
      "OPENAI_API_KEY=REDACTED",
      "API_KEY = REDACTED",
      "token: REDACTED",
      "\"apiKey\": \"REDACTED\",",
      "password = REDACTED",
      "secret: REDACTED",
    ].join("\n"));
  });

  it("returns a clear result when another snapshot is already running", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "feather-supervisor-snapshot-lock-"));
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(home, "locks"), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(home, "locks", "snapshot.lock"), "locked", "utf8");

    const snapshot = createSnapshot({
      featherHomeDir: home,
      repoRoot: repo,
      snapshotsDir: path.join(root, "snapshots"),
      reason: "locked",
    });

    expect(snapshot.ok).toBe(false);
    expect(snapshot.files).toEqual([]);
    expect(snapshot.warnings[0]).toContain("Snapshot already in progress");
  });

  it("skips a busy non-critical file after retries and keeps a useful snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "feather-supervisor-snapshot-busy-"));
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(home, "agent.md"), "busy", "utf8");
    fs.writeFileSync(path.join(repo, "package.json"), "{\"name\":\"feather\"}\n", "utf8");

    const realCopyFileSync = fs.copyFileSync.bind(fs);
    vi.spyOn(fs, "copyFileSync").mockImplementation((source, target, mode) => {
      if (String(source).endsWith("agent.md")) {
        const error = new Error("file is busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      return realCopyFileSync(source, target, mode);
    });

    const snapshot = createSnapshot({
      featherHomeDir: home,
      repoRoot: repo,
      snapshotsDir: path.join(root, "snapshots"),
      reason: "busy file",
    });

    expect(snapshot.ok).toBe(true);
    expect(snapshot.files).toContain("runtime/package.json");
    expect(snapshot.skipped).toContain("home/agent.md");
    expect(snapshot.warnings.some((warning) => warning.includes("home/agent.md"))).toBe(true);
  });
});
