#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { FEATHER_BASE_URL } from "@feather/shared";
import { formatDoctorReport, renderCommandsGuide, runDoctor, runSetupBootstrap } from "./lib.js";

const API = FEATHER_BASE_URL;

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

const program = new Command();

program
  .name("feather")
  .description("Feather — lightweight local harness for Codex/API agent workflows")
  .version("0.1.0-alpha");

program
  .command("commands")
  .description("Show a grouped reference of working Feather CLI commands")
  .action(() => {
    console.log(renderCommandsGuide());
  });

// ── daemon ──────────────────────────────────────────────────────────────────
const daemon = program.command("daemon");

daemon
  .command("start")
  .description("Start the Feather daemon")
  .option("--port <port>", "Port to listen on", "47383")
  .action(async (opts) => {
    const { startDaemon } = await import("@feather/core");
    console.log(chalk.blue("Starting Feather daemon..."));
    await startDaemon({ port: parseInt(opts.port as string, 10) });
  });

daemon
  .command("stop")
  .description("Stop the Feather daemon (sends panic + stops heartbeat)")
  .action(async () => {
    try {
      await apiFetch("/panic", { method: "POST" });
      console.log(chalk.yellow("Daemon panic activated. Stop the process manually."));
    } catch {
      console.log(chalk.red("Could not reach daemon. Is it running?"));
    }
  });

// ── status ──────────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    try {
      const data = await apiFetch("/health") as { ok: boolean; version: string; panic: { active: boolean } };
      console.log(chalk.green(`✓ Feather daemon v${data.version} is running`));
      if (data.panic?.active) console.log(chalk.red("  ⚠ PANIC MODE ACTIVE"));
    } catch {
      console.log(chalk.red("✗ Feather daemon is not reachable"));
    }
  });

// ── init ────────────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialise Feather config in current directory")
  .action(async () => {
    const { initProjectConfig, loadGlobalConfig, saveGlobalConfig, getFeatherHomeDir } = await import("@feather/core");
    const path = await import("node:path");
    const cwd = process.cwd();
    const name = path.basename(cwd);

    initProjectConfig(cwd, name);

    // Ensure global config exists
    const config = loadGlobalConfig();
    saveGlobalConfig(config);

    console.log(chalk.green(`✓ Initialised Feather config in ${cwd}`));
    console.log(chalk.gray(`  .feather/project.yml`));
    console.log(chalk.gray(`  .feather/instructions.md`));
    console.log(chalk.gray(`  Global config: ${getFeatherHomeDir()}/config.yml`));
    console.log(chalk.gray(`  Run 'feather setup' to launch the full onboarding flow.`));
  });

program
  .command("setup")
  .description("Bootstrap Feather home, config, agent profile, and database")
  .action(async () => {
    const result = await runSetupBootstrap();
    console.log(chalk.green("✓ Feather bootstrap complete"));
    console.log(chalk.gray(`  Home: ${result.featherHomeDir}`));
    console.log(chalk.gray(`  Config: ${result.configPath}${result.createdConfig ? " (created)" : ""}`));
    console.log(chalk.gray(`  Agent: ${result.agentPath}${result.createdAgent ? " (created)" : ""}`));
    console.log(chalk.gray(`  DB: ${result.dbPath}${result.createdDb ? " (created)" : ""}`));
    console.log();
    console.log("Next steps:");
    console.log(chalk.gray("  1. Start Feather with `pnpm dev` or `pnpm --filter @feather/cli exec tsx src/main.ts daemon start`."));
    console.log(chalk.gray("  2. Open the dashboard and add a provider."));
    console.log(chalk.gray("  3. Register a project in the dashboard or with `pnpm --filter @feather/cli exec tsx src/main.ts project add <path>`."));
    console.log(chalk.gray("  4. Telegram is optional for alpha; configure it later if you want phone control."));
    console.log(chalk.gray("  5. Guard is optional for alpha; run `pnpm --filter @feather/supervisor exec tsx src/main.ts status` when needed."));
  });

program
  .command("doctor")
  .description("Inspect local Feather setup, daemon health, and optional integrations")
  .action(async () => {
    const result = await runDoctor();
    const output = formatDoctorReport(result);
    console.log(result.exitCode === 0 ? chalk.green(output) : chalk.yellow(output));
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  });

// ── dashboard ────────────────────────────────────────────────────────────────
program
  .command("dashboard")
  .description("Open the Feather dashboard in your browser")
  .action(async () => {
    const { exec } = await import("node:child_process");
    const url = FEATHER_BASE_URL;
    console.log(chalk.blue(`Opening dashboard at ${url}`));
    exec(`start ${url}`);
  });

// ── project ──────────────────────────────────────────────────────────────────
const project = program.command("project");

project
  .command("add <path>")
  .description("Add a project to Feather")
  .option("--name <name>", "Project name (defaults to folder name)")
  .action(async (projectPath: string, opts) => {
    const pathMod = await import("node:path");
    const name = (opts.name as string | undefined) ?? pathMod.basename(pathMod.resolve(projectPath));
    const data = await apiFetch("/projects", {
      method: "POST",
      body: JSON.stringify({ name, rootPath: projectPath }),
    }) as { project: { id: string; name: string; rootPath: string } };
    console.log(chalk.green(`✓ Added project: ${data.project.name} (${data.project.rootPath})`));
  });

project
  .command("list")
  .description("List all projects")
  .action(async () => {
    const data = await apiFetch("/projects") as { projects: Array<{ id: string; name: string; rootPath: string; heartbeatEnabled: boolean }> };
    if (data.projects.length === 0) {
      console.log(chalk.gray("No projects registered. Run: feather project add <path>"));
      return;
    }
    for (const p of data.projects) {
      console.log(`${chalk.bold(p.name)} ${chalk.gray(p.rootPath)} ${p.heartbeatEnabled ? chalk.green("♥") : chalk.gray("♡")}`);
    }
  });

program
  .command("projects")
  .description("List all projects")
  .action(async () => {
    const data = await apiFetch("/projects") as { projects: Array<{ id: string; name: string; rootPath: string; heartbeatEnabled: boolean }> };
    if (data.projects.length === 0) {
      console.log(chalk.gray("No projects registered. Run: feather project add <path>"));
      return;
    }
    for (const p of data.projects) {
      console.log(`${chalk.bold(p.name)} ${chalk.gray(p.rootPath)} ${p.heartbeatEnabled ? chalk.green("♥") : chalk.gray("♡")}`);
    }
  });

project
  .command("recap <name>")
  .description("Generate a daily recap for a project")
  .action(async (name: string) => {
    const data = await apiFetch("/projects") as { projects: Array<{ id: string; name: string }> };
    const proj = data.projects.find((p) => p.name === name);
    if (!proj) {
      console.log(chalk.red(`Project not found: ${name}`));
      process.exit(1);
    }
    const recap = await apiFetch(`/projects/${proj.id}/recap`) as { recap: string };
    console.log(recap.recap);
  });

// ── task ─────────────────────────────────────────────────────────────────────
program
  .command("task <project> <prompt...>")
  .description("Send a task to a project")
  .option("--provider <id>", "Provider ID to use")
  .action(async (projectName: string, promptWords: string[], opts) => {
    const prompt = promptWords.join(" ");
    const data = await apiFetch("/projects") as { projects: Array<{ id: string; name: string }> };
    const proj = data.projects.find((p) => p.name === projectName);
    if (!proj) {
      console.log(chalk.red(`Project not found: ${projectName}`));
      process.exit(1);
    }

    const taskData = await apiFetch("/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: proj.id,
        title: prompt.slice(0, 80),
        prompt,
        providerId: opts.provider as string | undefined,
      }),
    }) as { task: { id: string } };

    console.log(chalk.green(`✓ Task created: ${taskData.task.id}`));
    console.log(chalk.gray(`Streaming output...`));

    // Stream events via SSE
    const res = await fetch(`${API}/tasks/${taskData.task.id}/stream`);
    if (!res.body) { console.log(chalk.red("No stream")); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { type: string; text?: string; content?: string; message?: string };
          if (evt.type === "provider_event") {
            const inner = (evt as unknown as { event: { type: string; text?: string } }).event;
            if (inner?.type === "text_delta" && inner.text) process.stdout.write(inner.text);
          } else if (evt.type === "summary") {
            console.log("\n" + chalk.blue("Summary: ") + evt.content);
          } else if (evt.type === "error") {
            console.log("\n" + chalk.red("Error: ") + evt.message);
          }
        } catch { /* skip */ }
      }
    }
  });

// ── approvals ────────────────────────────────────────────────────────────────
program
  .command("approvals")
  .description("List pending approvals")
  .action(async () => {
    const data = await apiFetch("/approvals") as { approvals: Array<{ id: string; title: string; risk: string; actionType: string }> };
    if (data.approvals.length === 0) {
      console.log(chalk.green("No pending approvals"));
      return;
    }
    for (const a of data.approvals) {
      const riskColor = a.risk === "dangerous" ? chalk.red : a.risk === "review" ? chalk.yellow : chalk.green;
      console.log(`${chalk.bold(a.id)} ${riskColor(`[${a.risk}]`)} ${a.title}`);
    }
  });

program
  .command("approve <id>")
  .description("Approve a pending action")
  .action(async (id: string) => {
    await apiFetch(`/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", scope: "once" }),
    });
    console.log(chalk.green(`✓ Approved: ${id}`));
  });

program
  .command("reject <id>")
  .description("Reject a pending action")
  .action(async (id: string) => {
    await apiFetch(`/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected" }),
    });
    console.log(chalk.yellow(`✗ Rejected: ${id}`));
  });

// ── heartbeat ────────────────────────────────────────────────────────────────
const hb = program.command("heartbeat");

hb.command("run")
  .description("Run the heartbeat now")
  .action(async () => {
    const data = await apiFetch("/heartbeat/run", { method: "POST" }) as { summary: string };
    console.log(chalk.green(`✓ ${data.summary}`));
  });

// ── providers ────────────────────────────────────────────────────────────────
const providerCmd = program.command("provider");

providerCmd
  .command("list")
  .description("List configured providers")
  .action(async () => {
    const data = await apiFetch("/providers") as { providers: Array<{ id: string; name: string; type: string }> };
    for (const p of data.providers) {
      console.log(`${chalk.bold(p.id)} ${chalk.gray(p.type)} — ${p.name}`);
    }
  });

providerCmd
  .command("test <id>")
  .description("Test a provider connection")
  .action(async (id: string) => {
    const data = await apiFetch(`/providers/${id}/validate`, { method: "POST" }) as { health: { ok: boolean; message: string } };
    if (data.health.ok) {
      console.log(chalk.green(`✓ ${data.health.message}`));
    } else {
      console.log(chalk.red(`✗ ${data.health.message}`));
    }
  });

// ── budget ───────────────────────────────────────────────────────────────────
program
  .command("budget status")
  .description("Show budget status")
  .action(async () => {
    const data = await apiFetch("/budgets/daily-spend") as { dailySpendCents: number };
    console.log(`Daily spend: ${chalk.yellow((data.dailySpendCents / 100).toFixed(2))} GBP`);
  });

// ── panic ────────────────────────────────────────────────────────────────────
program
  .command("panic")
  .description("Activate panic mode — stops all active operations")
  .action(async () => {
    await apiFetch("/panic", { method: "POST" });
    console.log(chalk.red("⚠ Panic mode activated. All operations suspended."));
    console.log(chalk.gray("Run 'feather resume' to restore normal operation."));
  });

program
  .command("resume")
  .description("Resume from panic mode")
  .action(async () => {
    await apiFetch("/resume", { method: "POST" });
    console.log(chalk.green("✓ Panic mode deactivated. Normal operation resumed."));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
