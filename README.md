# Feather

Feather is a lightweight local web harness for Codex/API-powered workflows.

It gives builders a control layer around agent work: projects, providers, approval gates, panic mode, budgets, heartbeat checks, Telegram control, explicit memory, local skills, and an external Guard supervisor foundation.

Status: public alpha.

Feather `v0.1.0-alpha` is usable for supervised local experiments and small real tasks, but APIs, provider behaviour, approval UX, Telegram routing, and Guard recovery flows may change quickly. This is not a production release.

---

## What Feather Is

- A localhost daemon plus web dashboard for running agent tasks against local projects
- A permission and approval layer around filesystem, shell, git, and provider actions
- A small operator surface for panic, budgets, heartbeat checks, explicit memory, local skills, and Telegram control
- A local harness that works with Codex CLI and API-style providers without requiring a heavy always-on desktop agent stack
- A Guard supervisor MVP focused on health, locks, snapshots, and recovery foundations

## What Feather Is Not

- Feather is not a replacement for Codex.
- Feather is not an unrestricted desktop-control agent.
- Feather is not a local LLM runtime.
- Feather is not a production security product.
- Feather is not a plugin marketplace, browser automation framework, remote agent cloud, or heavy agent OS.
- Feather does not bypass Codex approvals.
- Feather does not guarantee exact spend control unless provider pricing and usage data are configured.

## Alpha Safety Guarantees

- Panic state is durable and survives daemon restart.
- Panic state is also represented by a local `panic.lock` for the external Guard layer.
- Panic blocks new work and cancels active tasks.
- Task recovery is conservative.
- Task recovery is skipped when the daemon starts in panic mode.
- Codex dangerous auto-approval flags are not emitted.
- Review-risk file writes require approval.
- File write approvals include diff previews.
- Review-risk shell commands require approval.
- Telegram can activate panic, resume with confirmation, cancel tasks, and handle approvals.
- The gateway exposes structured `/health` and safe `/diagnostics/noop` endpoints for supervisor checks.
- Feather Guard is a separate supervisor app under `apps/supervisor`; it is narrow lifecycle supervision, not a second agent.
- Supervisor restart is disabled by default and only uses explicitly configured command + argv with shell execution disabled.

## Guard MVP

Feather Guard currently provides:

- structured `/health`
- safe `/diagnostics/noop`
- local lifecycle locks
- `panic.lock` integration
- a separate `apps/supervisor` process
- health polling and classification
- unreachable-gateway detection
- configured restart foundation, disabled by default
- safe mode via `safe-mode.lock`
- sanitized snapshot creation
- a file-based lifecycle request queue foundation

It does not yet provide full staged updates, real rollback, runtime manifest protection, signed releases, encrypted snapshots, OS-level separation, service installation, or supervisor Telegram notifications.

## Known Limitations

- Feather is not production-ready.
- Codex process cancellation is best-effort.
- OpenAI-compatible budget enforcement requires pricing fields and provider usage events.
- Providers without pricing stay in usage-only / unknown-pricing mode.
- File diffs are still simple full-replace diffs in this alpha.
- OpenAI, OpenRouter, and OpenAI-compatible providers use a lightweight text-based `feather_tool` protocol today; native provider tool-calling is not implemented yet.
- Tool-heavy API-provider tasks are still less predictable than Codex CLI and should be treated as supervised workflows.
- Desktop app packaging is not part of `v0.1.0-alpha`; Feather uses a local web dashboard.
- Snapshots are sanitized but not encrypted.
- OS-level user separation and ACL hardening are not implemented.

---

## Quick Start

Requirements: Node.js 20+, pnpm 9+

```sh
pnpm install
pnpm build
pnpm dev
```

`pnpm dev` starts the daemon and dashboard development server. The dashboard runs at `http://localhost:5173` during development.

If you want the packaged CLI flow instead, build first and then run `feather daemon start`.

## Local Setup Flow

1. Run `pnpm dev`.
2. Open the dashboard and finish onboarding.
3. Configure at least one provider.
4. Add a project root Feather is allowed to work in.
5. Optionally configure Telegram for approvals and panic control.
6. Start tasks from the dashboard or CLI.

Project-specific guidance lives in `.feather/instructions.md`, and repository-local `AGENTS.md` is loaded when present.

## Providers And Pricing

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
providers:
  coding: codex-cli
permissions:
  filesystem:
    read: ["."]
    write: ["src", "docs", "tests"]
    deny: [".env", ".env.*", "node_modules", ".git", "*.pem", "*.key"]
  shell:
    allow: ["pnpm test", "pnpm build", "git status", "git diff"]
    require_approval: ["pnpm install *", "git commit *"]
    deny: ["rm -rf *", "sudo *", "curl * | sh"]
heartbeat:
  enabled: true
  mode: passive
  checks:
    git_dirty:
      enabled: true
      cooldownMinutes: 120
    pending_approvals:
      enabled: true
      cooldownMinutes: 30
```

## Dashboard And Daemon

- `pnpm dev` starts the daemon plus dashboard HMR
- The daemon API serves on localhost only
- Built dashboard assets are served by the daemon after a production build

## Telegram Setup

Use onboarding if you want the simplest path. Feather also supports environment-variable setup:

1. Create a bot via [@BotFather](https://t.me/botfather).
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` locally.
3. Restart the daemon if you added credentials after it was already running.

Useful commands include `/status`, `/projects`, `/task <project> <prompt>`, `/approvals`, `/approve <id>`, `/reject <id>`, `/panic`, `/resume confirm`, `/budget`, and `/cancel <taskId>`.

The current build also supports deterministic freeform Telegram messages for status, approvals, panic/cancel, and task proposals. Action-style plain messages create a confirmation instead of starting work immediately.

## Explicit Memory

Feather supports explicit global and project memories through the dashboard, API, and Telegram commands.

- Memories are context only.
- Memories do not grant permissions.
- Memories do not bypass panic, approvals, budgets, denied paths, or secret blocking.

## Local Skills

Skills are local Markdown workflow packs stored under `~/.feather/skills/` or `<project>/.feather/skills/`.

- Skills narrow how a task should run.
- Skills do not grant permissions.
- Selected skills are included in the task system prompt.
- Tools outside the selected skill allowlist are blocked before execution.

## Heartbeat Personalization

Heartbeat stays supervised in this alpha.

- `off` disables it
- `manual` runs only on demand
- `passive` observes and summarizes
- `proactive` can attach suggested actions, but it does not auto-start tasks

Project heartbeat settings are editable in the dashboard and stored in `.feather/project.yml`.

## Panic And Resume

- Dashboard panic stops active work and stops heartbeat
- Telegram `/panic` does the same
- Resume requires confirmation via `/resume confirm` in Telegram or the dashboard resume control
- If the daemon restarts while panic is active, API and Telegram still come up, but mutating task recovery stays off until you resume

---

## Architecture

```text
Feather Guard Supervisor
     |
     | watches health, locks, snapshots
     v
Core Daemon / Gateway (Fastify, localhost)
     |
     | runs tasks through approval, permission, budget, and routing gates
     v
Providers / tools / projects

Dashboard and CLI talk to the core daemon.
Telegram is optional and uses the same daemon safety gates.
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/shared` | Types, schemas, constants, errors |
| `packages/core` | Daemon, DB, services, providers, tools, API |
| `apps/cli` | `feather` CLI |
| `apps/dashboard` | React web UI |
| `apps/supervisor` | Feather Guard external supervisor MVP |

## Docs

- [Vision](docs/vision.md)
- [What Feather is and isn't](docs/what-it-is-and-isnt.md)
- [Security model](docs/security-model.md)
- [Architecture](docs/architecture.md)
- [Provider adapters](docs/provider-adapters.md)
- [Tool system](docs/tool-system.md)
- [Heartbeat](docs/heartbeat.md)
- [Feather Guard](docs/feather-guard.md)
- [Telegram freeform](docs/telegram-freeform.md)
- [Memory](docs/memory.md)
- [Skills](docs/skills.md)
- [Project config](docs/project-config.md)
- [Remote mode](docs/remote-mode.md)
- [Roadmap](docs/roadmap.md)
- [Alpha checklist](docs/ALPHA_CHECKLIST.md)
- [Current bug log](docs/V0_2_BUG_LOG.md)

---

## License

MIT
