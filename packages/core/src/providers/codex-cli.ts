import { execa } from "execa";
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

    const args: string[] = [];
    if (input.systemPrompt) {
      args.push("--instructions", input.systemPrompt);
    }
    args.push(input.prompt);

    // Safe env — only pass through known-safe env vars, strip secrets
    const safeEnv = buildSafeEnv();

    try {
      const child = execa(this.command, args, {
        cwd: input.project.rootPath,
        env: safeEnv,
        all: true,
        reject: false,
      });
      this.activeTasks.set(input.taskId, child);

      if (child.all) {
        for await (const chunk of child.all) {
          yield { type: "text_delta", text: chunk.toString() };
        }
      }

      const result = await child;

      if (result.exitCode !== 0) {
        yield {
          type: "error",
          error: `Codex CLI exited with code ${result.exitCode}: ${result.stderr}`,
        };
      } else {
        yield { type: "done", summary: "Codex CLI task completed." };
      }
    } catch (err) {
      yield { type: "error", error: `Failed to spawn Codex CLI: ${String(err)}` };
    } finally {
      this.activeTasks.delete(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const child = this.activeTasks.get(taskId);
    if (!child) return;
    child.kill("SIGTERM");
  }
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
