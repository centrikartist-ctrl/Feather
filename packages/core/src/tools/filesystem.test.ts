import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { _resetPanicForTesting } from "../panic/index.js";
import { PermissionService } from "../permissions/index.js";
import { prepareWriteFile, commitPreparedWrite, writeFile } from "./filesystem.js";

let tempDir: string;
let projectRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-fs-test-"));
  projectRoot = path.join(tempDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  initDb(path.join(tempDir, "test.db"));
  _resetPanicForTesting();
});

afterEach(() => {
  closeDb();
  _resetPanicForTesting();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("prepareWriteFile + commitPreparedWrite", () => {
  it("writes the file when approvalResolved is true", () => {
    const prepared = prepareWriteFile(
      { path: "out.txt", content: "hello" },
      { projectRoot },
    );
    const result = commitPreparedWrite(prepared, { projectRoot, approvalResolved: true });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, "out.txt"), "utf8")).toBe("hello");
  });

  it("denies the write when approvalResolved is false", () => {
    const prepared = prepareWriteFile(
      { path: "out.txt", content: "hello" },
      { projectRoot },
    );
    const result = commitPreparedWrite(prepared, { projectRoot, approvalResolved: false });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Approval required/);
    expect(fs.existsSync(path.join(projectRoot, "out.txt"))).toBe(false);
  });

  it("denies the write when approvalResolved is omitted", () => {
    const prepared = prepareWriteFile(
      { path: "out.txt", content: "hello" },
      { projectRoot },
    );
    const result = commitPreparedWrite(prepared, { projectRoot });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Approval required/);
  });

  it("captures diff from before-state in PreparedWrite", () => {
    const existingPath = path.join(projectRoot, "existing.txt");
    fs.writeFileSync(existingPath, "old content", "utf8");

    const prepared = prepareWriteFile(
      { path: "existing.txt", content: "new content" },
      { projectRoot },
    );

    expect(prepared.isNewFile).toBe(false);
    expect(prepared.diff).toContain("-old content");
    expect(prepared.diff).toContain("+new content");
    expect(prepared.previousHash).toBeDefined();
    expect(prepared.nextHash).toBeDefined();
    expect(prepared.previousHash).not.toBe(prepared.nextHash);
  });

  it("marks new files as isNewFile = true with no previousHash", () => {
    const prepared = prepareWriteFile(
      { path: "brand-new.txt", content: "first content" },
      { projectRoot },
    );

    expect(prepared.isNewFile).toBe(true);
    expect(prepared.previousHash).toBeNull();
    expect(prepared.nextHash).toBeDefined();
  });

  it("blocks write when file was modified between prepare and commit (stale guard)", () => {
    const filePath = path.join(projectRoot, "changing.txt");
    fs.writeFileSync(filePath, "original", "utf8");

    const prepared = prepareWriteFile(
      { path: "changing.txt", content: "intended new content" },
      { projectRoot },
    );

    // Simulate external modification after prepare but before commit
    fs.writeFileSync(filePath, "changed by something else", "utf8");

    const result = commitPreparedWrite(prepared, { projectRoot, approvalResolved: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/changed after approval preview/);
    // File should NOT be overwritten with the intended content
    expect(fs.readFileSync(filePath, "utf8")).toBe("changed by something else");
  });
});

describe("writeFile P5: direct review-risk write is denied without approvalResolved", () => {
  it("denies a review-risk write when approvalResolved is false", async () => {
    // No write allowlist → every write is review-risk per PermissionService logic
    const permissions = new PermissionService(projectRoot, null);

    const result = await writeFile(
      { path: "secret.txt", content: "some data" },
      { projectRoot, permissions, approvalResolved: false },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Approval required/);
    expect(fs.existsSync(path.join(projectRoot, "secret.txt"))).toBe(false);
  });

  it("denies a review-risk write when approvalResolved is omitted", async () => {
    const permissions = new PermissionService(projectRoot, null);

    const result = await writeFile(
      { path: "secret.txt", content: "some data" },
      { projectRoot, permissions },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Approval required/);
  });

  it("allows a write when approvalResolved is true", async () => {
    const permissions = new PermissionService(projectRoot, null);

    const result = await writeFile(
      { path: "allowed.txt", content: "approved content" },
      { projectRoot, permissions, approvalResolved: true },
    );

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, "allowed.txt"), "utf8")).toBe("approved content");
  });
});
