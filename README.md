# Feather

A lightweight, open-source, local web dashboard and daemon harness for running Codex/API-powered agent workflows.

> Codex with a good harness is elite. Feather is the lightweight harness for people who do not have workstation hardware and do not want a huge always-on agent stack.

Status: early build, active development, and interfaces may still change.

---

## What it does

- Register local projects
- Connect providers: Codex CLI, OpenAI API, OpenRouter, any OpenAI-compatible endpoint
- Send tasks to a project and stream output
- Permission-gated filesystem, shell, and git tools (default deny)
- Approval queue for risky actions — approve from the dashboard or Telegram
- Heartbeat engine: git dirty checks, pending approval alerts, daily recaps
- Budget limits with per-task and daily cost caps
- Panic button — instant lockdown from dashboard, CLI, or Telegram
- Optional Telegram bot for phone-based approvals and task creation

---

## Quick start

**Requirements:** Node.js 20+, pnpm 9+

```sh
# Install dependencies
pnpm install

# Build shared and core packages
pnpm --filter @feather/shared build
pnpm --filter @feather/core build
pnpm --filter @feather/cli build

# Start the daemon plus dashboard HMR at http://localhost:5173
pnpm dev

# Or run the packaged daemon and open the guided setup flow
feather daemon start
feather setup
```

On first launch, Feather now blocks on onboarding until you finish two stages:

1. Machine setup: configure at least one provider, decide whether to wire Telegram now, and register your first project.
2. Agent profile: answer a chat-style builder that writes your global personal-agent file at `~/.feather/agent.md`.

Project-specific guidance still lives in `.feather/instructions.md`, and repository-local `AGENTS.md` is still loaded when present.

---

## Setup to working agent

1. Start the daemon with `pnpm dev` during development or `feather daemon start` for the packaged build.
2. Open the dashboard or run `feather setup`.
3. In machine setup:
  - Add an enabled provider. Start cheap for smoke tests, for example `gpt-5.4-mini` or `gpt-4o-mini`.
  - Decide Telegram now. If you want mobile approvals, create a bot with [@BotFather](https://t.me/botfather), then enter the bot token and allowed numeric user IDs.
  - Register the first project root Feather should work on.
4. In the agent builder chat, define the global agent name, role, mission, tone, autonomy, boundaries, workflow habits, and reporting style.
5. Start sending tasks from the dashboard home page or the CLI.

If you add Telegram credentials while the daemon is already running, restart the daemon once so the bot connection can be established with the saved config.

---

## Architecture

```
CLI (feather)
     ↓
Core Daemon (Fastify, port 47383, localhost only)
     ├── Project Registry
     ├── Task Runner → Provider (Codex CLI / OpenAI / OpenRouter)
     ├── Approval Queue
     ├── Heartbeat Service
     ├── Permission Service (per-project, default deny)
     ├── Budget Service
     ├── Panic Module
     └── SQLite DB (~/.feather/feather.db)

Dashboard (served by daemon on port 47383)
Telegram Bot (optional, long-poll)
```

---

## Project config

Each project stores config in `.feather/project.yml`:

```yaml
name: my-project
codingProvider: codex-cli
permissions:
  allowedPaths: ["src/", "tests/"]
  shellCommandAllow: ["npm test", "pnpm build"]
  shellCommandReview: ["npm install *"]
heartbeat:
  enabled: true
  mode: passive
  checks:
    git_dirty: true
    pending_approvals: true
budget:
  dailyLimitCents: 500
  taskLimitCents: 100
```

Customize agent instructions in `.feather/instructions.md`.

---

## Telegram setup

Use the onboarding flow if you want the easiest path. Feather also still supports environment-variable setup:

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Set environment variables:
  ```sh
  TELEGRAM_BOT_TOKEN=your_token
  TELEGRAM_ALLOWED_USER_IDS=123456789
  ```
3. Start the daemon — the bot will auto-connect

Commands: `/status`, `/projects`, `/task <project> <prompt>`, `/approvals`, `/approve <id>`, `/reject <id>`, `/recap <project>`, `/budget`

---

## Packages

| Package | Description |
|---------|-------------|
| `packages/shared` | Types, schemas, constants, errors |
| `packages/core` | Daemon, DB, services, providers, tools, API |
| `apps/cli` | `feather` CLI |
| `apps/dashboard` | React web UI |

---

## Docs

- [Vision](docs/vision.md)
- [What Feather is and isn't](docs/what-it-is-and-isnt.md)
- [Security model](docs/security-model.md)
- [Architecture](docs/architecture.md)
- [Provider adapters](docs/provider-adapters.md)
- [Tool system](docs/tool-system.md)
- [Heartbeat](docs/heartbeat.md)
- [Project config](docs/project-config.md)
- [Remote mode](docs/remote-mode.md)
- [Roadmap](docs/roadmap.md)

---

## License

MIT
