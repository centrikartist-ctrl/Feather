# Feather

Feather is a lightweight local web harness for Codex/API-powered workflows.

It gives builders a control layer around agents: projects, providers, approvals, panic mode, budgets, heartbeat checks, Telegram control, and daily recaps.

Status: alpha. This is still an early supervised local operator build and should be treated as v0.01, not a release. It is usable for local experiments and small real tasks, but interfaces, provider behavior, and approval UX may still change between builds.

---

## What Feather is

- A localhost daemon plus web dashboard for running agent tasks against local projects
- A permission and approval layer around filesystem, shell, git, and provider actions
- A small operator surface for panic, budgets, heartbeat checks, and Telegram control
- A local harness that works with Codex CLI and API-style providers without requiring a heavy always-on desktop agent stack

## What Feather is not

- Feather is not a replacement for Codex.
- Feather is not an unrestricted desktop-control agent.
- Feather is not a local LLM runtime.
- Feather does not bypass Codex approvals.
- Feather does not guarantee exact spend control unless provider pricing and usage data are configured.

## Alpha safety guarantees

- Panic state is durable and survives daemon restart.
- Panic blocks new work and cancels active tasks.
- Task recovery is conservative.
- Task recovery is skipped when the daemon starts in panic mode.
- Codex dangerous auto-approval flags are not emitted.
- Review-risk file writes require approval.
- File write approvals include diff previews.
- Review-risk shell commands require approval.
- Telegram can activate panic, resume with confirmation, cancel tasks, and handle approvals.

## Known limitations

- Codex process cancellation is best-effort.
- OpenAI-compatible budget enforcement requires pricing fields and provider usage events.
- Providers without pricing stay in usage-only / unknown-pricing mode.
- File diffs are still simple full-replace diffs in v0.01.
- OpenAI, OpenRouter, and OpenAI-compatible providers use a lightweight Feather tool protocol today; native provider tool-calling is not implemented yet.
- Tool-heavy API-provider tasks are still less predictable than Codex CLI and should be treated as supervised workflows.
- Desktop app packaging is not part of v0.01; Feather uses a local web dashboard.

## Current In-Progress Additions

- Freeform Telegram routing for read-only questions, task proposals, panic/cancel, and approval responses.
- Explicit editable memory with global and project scope.
- Local skill files for reusable workflow instructions.
- More configurable heartbeat modes, checks, cooldowns, and recap instructions.

---

## Quick start

**Requirements:** Node.js 20+, pnpm 9+

```sh
pnpm install
pnpm build
pnpm dev
```

`pnpm dev` starts the daemon and dashboard development server. The dashboard runs at `http://localhost:5173` during development.

If you want the packaged CLI flow instead, build first and then run `feather daemon start`.

## Local setup flow

1. Run `pnpm dev`.
2. Open the dashboard and finish onboarding.
3. Configure at least one provider.
4. Add a project root Feather is allowed to work in.
5. Optionally configure Telegram for approvals and panic control.
6. Start tasks from the dashboard or CLI.

Project-specific guidance still lives in `.feather/instructions.md`, and repository-local `AGENTS.md` is still loaded when present.

## Providers and pricing

Feather currently supports:

- Codex CLI
- OpenAI API
- OpenRouter
- Any OpenAI-compatible endpoint

For OpenAI, OpenRouter, and OpenAI-compatible providers you can optionally set:

- `inputCentsPer1MTokens`
- `outputCentsPer1MTokens`

Those pricing fields are used for budget estimates. If you leave them blank, Feather can still record token usage, but it cannot claim hard spend enforcement.

For Codex CLI, the `mode` field is currently informational only. It does not bypass Feather approvals.

## Projects

Register projects in the dashboard during onboarding or from the Projects page later.

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

## Dashboard and daemon

- `pnpm dev` starts the daemon plus dashboard HMR
- The daemon API serves on localhost only
- Built dashboard assets are served by the daemon after a production build

## Telegram setup

Use onboarding if you want the simplest path. Feather also supports environment-variable setup:

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Set:

```sh
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_ALLOWED_USER_IDS=123456789
```

3. Restart the daemon if you added credentials after it was already running

Useful commands include `/status`, `/projects`, `/task <project> <prompt>`, `/approvals`, `/approve <id>`, `/reject <id>`, `/panic`, `/resume confirm`, `/budget`, and `/cancel <taskId>`.

The current build also supports deterministic freeform Telegram messages for status, approvals, panic/cancel, and task proposals. Action-style plain messages create a confirmation instead of starting work immediately.

## Explicit memory

Feather now supports explicit global and project memories through the dashboard, API, and Telegram commands.

- Memories are context only.
- Memories do not grant permissions.
- Memories do not bypass panic, approvals, budgets, denied paths, or secret blocking.

## Local skills

Skills are local Markdown workflow packs stored under `~/.feather/skills/` or `<project>/.feather/skills/`.

- Skills narrow how a task should run.
- Skills do not grant permissions.
- Selected skills are included in the task system prompt.
- Tools outside the selected skill allowlist are blocked before execution.

## Heartbeat personalization

Heartbeat stays supervised in this v0.01 build.

- `off` disables it
- `manual` runs only on demand
- `passive` observes and summarizes
- `proactive` can attach suggested actions, but it does not auto-start tasks

Project heartbeat settings are editable in the dashboard and stored in `.feather/project.yml`.

## Panic and resume

- Dashboard panic stops active work and stops heartbeat
- Telegram `/panic` does the same
- Resume requires confirmation via `/resume confirm` in Telegram or the dashboard resume control
- If the daemon restarts while panic is active, API and Telegram still come up, but mutating task recovery stays off until you resume

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

Customize agent instructions in `.feather/instructions.md`.

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
- [Telegram freeform](docs/telegram-freeform.md)
- [Memory](docs/memory.md)
- [Skills](docs/skills.md)
- [Project config](docs/project-config.md)
- [Remote mode](docs/remote-mode.md)
- [Roadmap](docs/roadmap.md)
- [Alpha checklist](docs/ALPHA_CHECKLIST.md)
- [current bug log](docs/V0_2_BUG_LOG.md)

---

## License

MIT
