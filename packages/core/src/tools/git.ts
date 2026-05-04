import { execa } from "execa";
import { z } from "zod";
import type { ToolResult } from "@feather/shared";

export type GitContext = {
  projectRoot: string;
};

export const GitStatusInput = z.object({});
export const GitDiffInput = z.object({
  staged: z.boolean().default(false),
  filePath: z.string().optional(),
});
export const GitBranchInput = z.object({});
export const GitLogInput = z.object({
  limit: z.number().int().positive().max(50).default(10),
});

export async function gitStatus(ctx: GitContext): Promise<ToolResult> {
  return runGit(["status", "--short", "--branch"], ctx.projectRoot);
}

export async function gitDiff(
  input: z.infer<typeof GitDiffInput>,
  ctx: GitContext,
): Promise<ToolResult> {
  const args = ["diff"];
  if (input.staged) args.push("--staged");
  if (input.filePath) args.push("--", input.filePath);
  return runGit(args, ctx.projectRoot);
}

export async function gitBranch(ctx: GitContext): Promise<ToolResult> {
  return runGit(["branch", "--show-current"], ctx.projectRoot);
}

export async function gitLog(
  input: z.infer<typeof GitLogInput>,
  ctx: GitContext,
): Promise<ToolResult> {
  return runGit(
    ["log", `--max-count=${input.limit}`, "--oneline", "--no-color"],
    ctx.projectRoot,
  );
}

async function runGit(args: string[], cwd: string): Promise<ToolResult> {
  try {
    const result = await execa("git", args, {
      cwd,
      reject: false,
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || `git exited with code ${result.exitCode}`,
      };
    }

    return { ok: true, output: result.stdout };
  } catch (err) {
    return { ok: false, error: `git not found or failed: ${String(err)}` };
  }
}
