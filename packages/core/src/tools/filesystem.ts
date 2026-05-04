import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolResult } from "@feather/shared";
import type { PermissionService } from "../permissions/index.js";
import { assertNotPanic } from "../panic/index.js";

export type ToolContext = {
  projectRoot?: string;
  permissions?: PermissionService;
  /**
   * Must be true before a review-risk write is committed.
   * The TaskRunner sets this after approval is resolved.
   * Direct callers without approval resolution must leave this unset (default false).
   */
  approvalResolved?: boolean;
};

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// filesystem.readFile
export const ReadFileInput = z.object({ path: z.string() });
export async function readFile(
  input: z.infer<typeof ReadFileInput>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (ctx.permissions) {
      ctx.permissions.assertFilesystemRead(input.path);
    }

    const resolved = ctx.projectRoot
      ? path.resolve(ctx.projectRoot, input.path)
      : path.resolve(input.path);

    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `File not found: ${input.path}` };
    }

    const content = fs.readFileSync(resolved, "utf8");
    return { ok: true, output: content };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// filesystem.listFiles
export const ListFilesInput = z.object({
  path: z.string().default("."),
  recursive: z.boolean().default(false),
});
export async function listFiles(
  input: z.infer<typeof ListFilesInput>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (ctx.permissions) {
      ctx.permissions.assertFilesystemRead(input.path);
    }

    const resolved = ctx.projectRoot
      ? path.resolve(ctx.projectRoot, input.path)
      : path.resolve(input.path);

    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `Directory not found: ${input.path}` };
    }

    const entries = input.recursive
      ? listRecursive(resolved, ctx.projectRoot ?? resolved)
      : fs.readdirSync(resolved).map((name) => {
          const full = path.join(resolved, name);
          const stat = fs.statSync(full);
          return { name, type: stat.isDirectory() ? "directory" : "file" };
        });

    return { ok: true, output: entries };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function listRecursive(dir: string, root: string): Array<{ name: string; type: string; relativePath: string }> {
  const results: Array<{ name: string; type: string; relativePath: string }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      results.push({ name: entry.name, type: "directory", relativePath: rel });
      results.push(...listRecursive(full, root));
    } else {
      results.push({ name: entry.name, type: "file", relativePath: rel });
    }
  }
  return results;
}

// filesystem.writeFile
export const WriteFileInput = z.object({
  path: z.string(),
  content: z.string(),
});

/**
 * Prepared write: captures the before-state diff and hashes so the approval
 * payload can show the exact diff before any write happens.
 */
export type PreparedWrite = {
  path: string;
  resolvedPath: string;
  previousContent: string | null;
  previousHash: string | null;
  nextContent: string;
  nextHash: string;
  diff: string;
  isNewFile: boolean;
  contentLength: number;
};

/**
 * Prepare a file write: read the current content, compute diff and hashes.
 * Does NOT write anything. Call commitPreparedWrite() after approval.
 */
export function prepareWriteFile(
  input: z.infer<typeof WriteFileInput>,
  ctx: ToolContext,
): PreparedWrite {
  assertNotPanic();

  const resolvedPath = ctx.projectRoot
    ? path.resolve(ctx.projectRoot, input.path)
    : path.resolve(input.path);

  const previousContent = fs.existsSync(resolvedPath)
    ? fs.readFileSync(resolvedPath, "utf8")
    : null;

  const previousHash = previousContent !== null ? sha256(previousContent) : null;
  const nextHash = sha256(input.content);
  const diff = computeSimpleDiff(previousContent ?? "", input.content, input.path);

  return {
    path: input.path,
    resolvedPath,
    previousContent,
    previousHash,
    nextContent: input.content,
    nextHash,
    diff,
    isNewFile: previousContent === null,
    contentLength: input.content.length,
  };
}

/**
 * Commit a prepared write. Verifies the file has not changed since prepare,
 * then writes. Requires ctx.approvalResolved === true.
 */
export function commitPreparedWrite(
  prepared: PreparedWrite,
  ctx: ToolContext,
): ToolResult {
  try {
    assertNotPanic();

    if (!ctx.approvalResolved) {
      return { ok: false, error: "Approval required before filesystem write." };
    }

    // Stale-content guard: reject if the file was modified after the diff was computed.
    const currentContent = fs.existsSync(prepared.resolvedPath)
      ? fs.readFileSync(prepared.resolvedPath, "utf8")
      : null;
    const currentHash = currentContent !== null ? sha256(currentContent) : null;

    if (currentHash !== prepared.previousHash) {
      return {
        ok: false,
        error: "File changed after approval preview was created. Refusing to write stale approved content.",
      };
    }

    fs.mkdirSync(path.dirname(prepared.resolvedPath), { recursive: true });
    fs.writeFileSync(prepared.resolvedPath, prepared.nextContent, "utf8");

    return {
      ok: true,
      output: `Written: ${prepared.path}`,
      diff: prepared.diff,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Direct write helper. For review-risk paths this requires ctx.approvalResolved.
 * TaskRunner uses prepareWriteFile + commitPreparedWrite instead of this function
 * so that the diff is captured before the approval payload is created.
 */
export async function writeFile(
  input: z.infer<typeof WriteFileInput>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    assertNotPanic();

    if (ctx.permissions) {
      const check = ctx.permissions.checkFilesystemWrite(input.path);
      if (!check.allowed && check.risk === "blocked") {
        return { ok: false, error: `Write blocked: ${check.reason ?? input.path}` };
      }
      // P5: review-risk writes require explicit approval resolution.
      if (check.risk === "review" && !ctx.approvalResolved) {
        return { ok: false, error: "Approval required before filesystem write." };
      }
    }

    const resolved = ctx.projectRoot
      ? path.resolve(ctx.projectRoot, input.path)
      : path.resolve(input.path);

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing content for diff (before write).
    const existingContent = fs.existsSync(resolved)
      ? fs.readFileSync(resolved, "utf8")
      : null;

    fs.writeFileSync(resolved, input.content, "utf8");

    const diff =
      existingContent !== null && existingContent !== input.content
        ? computeSimpleDiff(existingContent, input.content, input.path)
        : undefined;

    return { ok: true, output: `Written: ${input.path}`, ...(diff !== undefined ? { diff } : {}) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Produce a simple unified-style diff so reviewers can see what changed.
 * Full-replace diff: all old lines shown as removed, all new as added.
 * Sufficient for v0.1 approval previews.
 */
function computeSimpleDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ].join("\n");
}
