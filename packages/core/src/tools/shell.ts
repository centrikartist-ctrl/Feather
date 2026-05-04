import { execa } from "execa";
import { z } from "zod";
import type { ToolResult } from "@feather/shared";
import type { PermissionService } from "../permissions/index.js";
import { assertNotPanic } from "../panic/index.js";

export type ShellContext = {
  projectRoot?: string;
  permissions?: PermissionService;
};

export const RunCommandInput = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

export async function runCommand(
  input: z.infer<typeof RunCommandInput>,
  ctx: ShellContext,
): Promise<ToolResult> {
  try {
    assertNotPanic();
    const fullCommand = [input.command, ...(input.args ?? [])].join(" ");

    if (ctx.permissions) {
      const check = ctx.permissions.checkShellCommand(fullCommand);
      if (!check.allowed) {
        return { ok: false, error: `Shell command blocked: ${check.reason ?? "denied"}` };
      }
      if (check.requiresApproval) {
        return {
          ok: false,
          error: `Command requires approval: ${fullCommand}`,
          output: { requiresApproval: true, command: fullCommand },
        };
      }
    }

    const cwd = input.cwd ?? ctx.projectRoot ?? process.cwd();

    const result = await execa(input.command, input.args ?? [], {
      cwd,
      timeout: input.timeoutMs ?? 60000,
      reject: false,
      all: true,
    });

    return {
      ok: result.exitCode === 0,
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      error: result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined,
    };
  } catch (err) {
    return { ok: false, error: `Failed to run command: ${String(err)}` };
  }
}
