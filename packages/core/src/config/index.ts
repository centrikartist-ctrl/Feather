import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import {
  ProjectFileConfigSchema,
  FEATHER_CONFIG_DIR,
  FEATHER_AGENT_FILE,
  FEATHER_PROJECT_CONFIG_FILE,
  FEATHER_INSTRUCTIONS_FILE,
  FEATHER_HEARTBEAT_CONFIG_FILE,
  FEATHER_BUDGET_CONFIG_FILE,
} from "@feather/shared";
import type { z } from "zod";

export type ProjectFileConfig = z.infer<typeof ProjectFileConfigSchema>;

export type GlobalConfig = {
  dbPath: string;
  daemonPort: number;
  logLevel: string;
  telegramBotToken?: string;
  allowedTelegramUserIds?: number[];
  panicMode?: boolean;
  onboarding?: {
    machineSetupCompleted?: boolean;
    telegramStepCompleted?: boolean;
    telegramEnabled?: boolean;
    agentSetupCompleted?: boolean;
    completedAt?: string;
  };
};

const FEATHER_HOME_ENV = "FEATHER_HOME_DIR";

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  dbPath: path.join(getFeatherHomeDir(), "feather.db"),
  daemonPort: 47383,
  logLevel: "info",
};

export function getFeatherHomeDir(): string {
  const overriddenHomeDir = process.env[FEATHER_HOME_ENV]?.trim();
  if (overriddenHomeDir) {
    return path.resolve(overriddenHomeDir);
  }

  return path.join(os.homedir(), ".feather");
}

function ensureFeatherHomeDir(): string {
  const dir = getFeatherHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getGlobalConfigPath(): string {
  return path.join(getFeatherHomeDir(), "config.yml");
}

export function getGlobalAgentFilePath(): string {
  return path.join(getFeatherHomeDir(), FEATHER_AGENT_FILE);
}

export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_GLOBAL_CONFIG };
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw) as Partial<GlobalConfig>;
  return { ...DEFAULT_GLOBAL_CONFIG, ...parsed };
}

export function saveGlobalConfig(config: GlobalConfig): void {
  const configDir = ensureFeatherHomeDir();
  fs.writeFileSync(getGlobalConfigPath(), yaml.dump(config), "utf8");
}

export function loadGlobalAgentInstructions(): string | null {
  const filePath = getGlobalAgentFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

export function saveGlobalAgentInstructions(content: string): void {
  ensureFeatherHomeDir();
  fs.writeFileSync(getGlobalAgentFilePath(), content, "utf8");
}

export function initGlobalAgentFile(agentName = "Feather"): void {
  const filePath = getGlobalAgentFilePath();
  if (fs.existsSync(filePath)) {
    return;
  }

  const template = `# ${agentName}

## Identity

- Name: ${agentName}
- Role: Lightweight personal software agent
- Mission: Help the user ship work safely, clearly, and with minimal overhead.

## Communication style

- Be direct and technically clear.
- Prefer small concrete next steps over broad abstraction.
- Summarise what changed, what remains, and any risks.

## Behavioural rules

- Ask before risky or irreversible actions.
- Do not touch environment files or secrets without explicit approval.
- Prefer tests and targeted validation before broad edits.

## Workflow preferences

- Start from the concrete failing surface when possible.
- Keep changes minimal and reversible.
- Preserve user-owned project instructions.
`;

  saveGlobalAgentInstructions(template);
}

export function loadProjectFileConfig(projectRoot: string): ProjectFileConfig | null {
  const configPath = path.join(projectRoot, FEATHER_CONFIG_DIR, FEATHER_PROJECT_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw);
  const result = ProjectFileConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid project config at ${configPath}: ${result.error.message}`);
  }
  return result.data;
}

export function saveProjectFileConfig(projectRoot: string, config: ProjectFileConfig): void {
  const configDir = path.join(projectRoot, FEATHER_CONFIG_DIR);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, FEATHER_PROJECT_CONFIG_FILE);
  fs.writeFileSync(configPath, yaml.dump(config), "utf8");
}

export function loadProjectInstructions(projectRoot: string): string | null {
  const filePath = path.join(projectRoot, FEATHER_CONFIG_DIR, FEATHER_INSTRUCTIONS_FILE);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

export function loadAgentsMd(projectRoot: string): string | null {
  const filePath = path.join(projectRoot, "AGENTS.md");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

export function buildTaskSystemPrompt(options: { projectRoot?: string; runtimeSystemPrompt?: string } = {}): string | undefined {
  const sections: string[] = [];
  const globalAgent = loadGlobalAgentInstructions();
  if (globalAgent?.trim()) {
    sections.push(`# Global Agent Profile\n\n${globalAgent.trim()}`);
  }

  if (options.projectRoot) {
    const projectInstructions = loadProjectInstructions(options.projectRoot);
    if (projectInstructions?.trim()) {
      sections.push(`# Project Instructions\n\n${projectInstructions.trim()}`);
    }

    const agentsMd = loadAgentsMd(options.projectRoot);
    if (agentsMd?.trim()) {
      sections.push(`# Repository AGENTS.md\n\n${agentsMd.trim()}`);
    }
  }

  if (options.runtimeSystemPrompt?.trim()) {
    sections.push(`# Runtime Guidance\n\n${options.runtimeSystemPrompt.trim()}`);
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : undefined;
}

export function initProjectConfig(projectRoot: string, projectName: string): void {
  const configDir = path.join(projectRoot, FEATHER_CONFIG_DIR);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, FEATHER_PROJECT_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      name: projectName,
      root: ".",
      permissions: {
        filesystem: {
          read: ["."],
          write: ["src", "docs", "tests"],
          deny: [".env", ".env.*", "node_modules", ".git", "*.pem", "*.key"],
        },
        shell: {
          allow: ["npm test", "npm run build", "npm run lint", "git status", "git diff"],
          require_approval: ["npm install *", "git commit *"],
          deny: ["rm -rf *", "sudo *", "curl * | sh", "powershell Invoke-Expression *"],
        },
      },
      heartbeat: {
        enabled: true,
        mode: "passive",
        interval_minutes: 30,
        checks: {
          git_dirty: true,
          pending_approvals: true,
        },
        quiet_hours: { start: "22:30", end: "08:00" },
      },
      agent: {
        instructions_file: ".feather/instructions.md",
        allow_agent_to_suggest_instruction_updates: true,
        require_approval_for_instruction_updates: true,
      },
    } as ProjectFileConfig;
    fs.writeFileSync(configPath, yaml.dump(defaultConfig), "utf8");
  }

  const instructionsPath = path.join(configDir, FEATHER_INSTRUCTIONS_FILE);
  if (!fs.existsSync(instructionsPath)) {
    const template = `# Project Instructions

This file is project-specific. Global personal-agent identity lives in ~/.feather/${FEATHER_AGENT_FILE}.

## Project goal

Describe what this project is meant to do.

## Hard constraints

- Do not add new features unless asked.
- Preserve existing architecture unless a change is explicitly approved.
- Prefer small, testable changes.
- Show diffs before risky writes.

## Design direction

Add project-specific design notes here.

## Verification

Before marking a task complete, run:

- npm test
- npm run build
- npm run lint

## Agent behaviour

- Ask for approval before dependency installs.
- Do not touch environment files.
- Summarise what changed and what remains.
`;
    fs.writeFileSync(instructionsPath, template, "utf8");
  }
}
