import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSnapshot, isSafeSnapshotSource } from "./snapshot.js";

describe("snapshot", () => {
  it("excludes secrets and redacts sensitive config lines", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "feather-supervisor-snapshot-"));
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(home, "config.yml"), "telegramBotToken: should-not-copy\nlogLevel: info\n", "utf8");
    fs.writeFileSync(path.join(home, ".env.local"), "OPENAI_API_KEY=secret\n", "utf8");
    fs.writeFileSync(path.join(repo, "package.json"), "{\"name\":\"feather\"}\n", "utf8");

    const snapshot = createSnapshot({
      featherHomeDir: home,
      repoRoot: repo,
      snapshotsDir: path.join(root, "snapshots"),
      reason: "test",
      now: new Date("2026-05-05T12:00:00Z"),
    });

    expect(fs.existsSync(path.join(snapshot.path, "home", ".env.local"))).toBe(false);
    expect(fs.readFileSync(path.join(snapshot.path, "home", "config.yml"), "utf8")).toContain("telegramBotToken: REDACTED");
    expect(snapshot.files).toContain("runtime/package.json");
  });

  it("rejects unsafe snapshot sources", () => {
    expect(isSafeSnapshotSource("x/.env.local")).toBe(false);
    expect(isSafeSnapshotSource("x/node_modules/pkg/index.js")).toBe(false);
    expect(isSafeSnapshotSource("x/config.yml")).toBe(true);
  });
});
