import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolResult } from "@feather/shared";
import type { PermissionService } from "../permissions/index.js";
import { assertNotPanic } from "../panic/index.js";

export type ToolContext = {
  projectRoot?: string;
  permissions?: PermissionService;
};

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
export async function writeFile(
  input: z.infer<typeof WriteFileInput>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    assertNotPanic();
    if (ctx.permissions) {
      ctx.permissions.assertFilesystemWrite(input.path);
    }

    const resolved = ctx.projectRoot
      ? path.resolve(ctx.projectRoot, input.path)
      : path.resolve(input.path);

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, input.content, "utf8");
    return { ok: true, output: `Written: ${input.path}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
