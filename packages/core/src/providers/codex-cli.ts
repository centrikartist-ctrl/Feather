import { execa } from "execa";
import { execSync } from "node:child_process";
import type { ProviderAdapter } from "./adapter.js";
import type {
  ProviderCapabilities,
  ProviderHealth,
  TaskInput,
  ProviderEvent,
} from "@feather/shared";

export type CodexCliConfig = {
  command?: string;
  mode?: "exec" | "apply";
  approvalMode?: "feather" | "auto" | "manual";
};

export class CodexCliProvider implements ProviderAdapter {
  id: string;
  name: string;
  type = "codex-cli";
  capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    coding: true,
    reasoning: true,
    costEstimate: false,
    supportsProjectRoot: true,
    costEnforcementMode: "unknown",
  };

  private detectedVersion: string | null = null;
  private activeTasks = new Map<string, ReturnType<typeof execa>>();

  constructor(
    id: string,
    private readonly config: CodexCliConfig = {},
  ) {
    this.id = id;
    this.name = `Codex CLI (${id})`;
  }

  private get command(): string {
    return this.config.command ?? "codex";
  }

  async validateConfig(): Promise<ProviderHealth> {
    try {
      const result = await execa(this.command, ["--version"], { timeout: 10000 });
      this.detectedVersion = result.stdout.trim();
      return { ok: true, message: `Codex CLI found: ${this.detectedVersion}` };
    } catch (err) {
      return {
        ok: false,
        message: `Codex CLI not found or not working. Make sure '${this.command}' is installed and in PATH. Error: ${String(err)}`,
      };
    }
  }

  async *startTask(input: TaskInput): AsyncIterable<ProviderEvent> {
    if (!input.project) {
      yield { type: "error", error: "Codex CLI provider requires a project with a rootPath" };
      return;
    }

    const { command: cmd, args } = buildCodexArgs(this.config, {
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
    });

    // Safe env — only pass through known-safe env vars, strip secrets
    const safeEnv = buildSafeEnv();

    const MAX_OUTPUT_CHARS = 200_000;
    let totalOutputChars = 0;
    let aborted = false;

    try {
      const child = execa(cmd, args, {
        cwd: input.project.rootPath,
        env: safeEnv,
        all: true,
        reject: false,
      });
      this.activeTasks.set(input.taskId, child);

      // Wire external abort signal.
      const onAbort = (): void => {
        aborted = true;
        forceKillChild(child);
      };
      if (input.signal?.aborted) {
        onAbort();
      } else {
        input.signal?.addEventListener("abort", onAbort, { once: true });
      }

      if (child.all) {
        for await (const chunk of child.all) {
          if (aborted) break;
          const text = chunk.toString();
          totalOutputChars += text.length;
          if (totalOutputChars > MAX_OUTPUT_CHARS) {
            aborted = true;
            forceKillChild(child);
            yield { type: "error", error: `Output ceiling of ${MAX_OUTPUT_CHARS} chars reached — task interrupted to prevent unbounded cost.` };
            return;
          }
          yield { type: "text_delta", text };
        }
      }

      const result = await child;

      if (aborted) {
        return;
      }

      if (result.exitCode !== 0) {
        yield {
          type: "error",
          error: `Codex CLI exited with code ${result.exitCode}: ${result.stderr}`,
        };
      } else {
        yield { type: "done", summary: "Codex CLI task completed." };
      }
    } catch (err) {
      if (aborted) return;
      yield { type: "error", error: `Failed to spawn Codex CLI: ${String(err)}` };
    } finally {
      input.signal?.removeEventListener("abort", () => { /* cleaned via aborted flag */ });
      this.activeTasks.delete(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const child = this.activeTasks.get(taskId);
    if (!child) return;
    forceKillChild(child);
  }
}

/**
 * Kill a child process. On Windows we attempt `taskkill /F /T /PID` for process tree
 * termination; on Unix we send SIGTERM then SIGKILL after a 3-second grace period.
 */
function forceKillChild(child: ReturnType<typeof execa>): void {
  if (process.platform === "win32") {
    try {
      if (child.pid) {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
      }
    } catch {
      child.kill();
    }
  } else {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 3000);
  }
}

export type CodexArgsBuildResult = {
  command: string;
  args: string[];
};

/**
 * Build the CLI args array for a Codex invocation.
 * Exported for unit testing.
 */
export function buildCodexArgs(
  config: CodexCliConfig,
  input: { prompt: string; systemPrompt?: string },
): CodexArgsBuildResult {
  const command = config.command ?? "codex";
  const args: string[] = [];

  // Approval mode determines how autonomous codex is.
  if (config.approvalMode === "auto") {
    args.push("--full-auto");
  }
  // mode: "exec" runs commands directly; "apply" is the default (review-first).
  // Both use the same CLI entry point in current codex-cli; this is a placeholder
  // for when the codex CLI exposes a --mode flag.
  if (config.mode === "exec") {
    args.push("--dangerously-auto-approve-everything");
  }

  if (input.systemPrompt) {
    args.push("--instructions", input.systemPrompt);
  }

  args.push(input.prompt);

  return { command, args };
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const SAFE_KEYS = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "APPDATA",
    "LOCALAPPDATA",
    "USERNAME",
    "COMPUTERNAME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CODEX_API_KEY",
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "COMSPEC",
  ]);

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_KEYS.has(key)) {
      env[key] = value;
    }
  }
  return env;
}
