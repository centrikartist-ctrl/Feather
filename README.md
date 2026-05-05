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

## Trying Feather Locally

Requirements: Node.js 20+, pnpm 9+

```sh
pnpm install
pnpm run setup
pnpm dev
```

`pnpm run setup` bootstraps `~/.feather/`, writes `config.yml` if missing, creates `agent.md` if missing, and initializes the local DB. It does not require an API key or Telegram.

`pnpm dev` starts the daemon, the dashboard development server, and Feather Guard watching in a separate supervisor process. The dashboard runs at `http://localhost:5173` during development.

During onboarding, Feather can store pasted API keys and Telegram bot tokens locally in `~/.feather/.env.local`. Process environment variables still take precedence if you already manage secrets outside Feather.

If you run the dashboard separately from the daemon, point it at the API with `VITE_FEATHER_API_BASE_URL=http://127.0.0.1:47383`.

Recommended first-run loop:

1. Run `pnpm run setup`.
2. Run `pnpm dev`.
3. Open the dashboard and add a provider.
4. Add a project root Feather is allowed to work in.
5. Create a small task.
6. Review approvals before risky writes or commands.
7. Use panic if anything feels wrong.

Useful local commands:

- `pnpm --filter @feather/cli exec tsx src/main.ts commands`
- `pnpm --filter @feather/cli exec tsx src/main.ts doctor`
- `pnpm --filter @feather/cli exec tsx src/main.ts projects`
- `pnpm --filter @feather/cli exec tsx src/main.ts task <project> <prompt>`

Project-specific guidance lives in `.feather/instructions.md`, and repository-local `AGENTS.md` is loaded when present.

## Developing Feather

```sh
pnpm install
pnpm dev
```

Common validation commands:

- `pnpm run check:repo-safety`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`

## Running Guard

`pnpm dev` now auto-launches Feather Guard for the normal local alpha flow, but Guard remains a separate external process in `apps/supervisor`.

Use the repo-local supervisor commands:

```sh
pnpm --filter @feather/supervisor exec tsx src/main.ts status
pnpm --filter @feather/supervisor exec tsx src/main.ts snapshot create "manual"
pnpm --filter @feather/supervisor exec tsx src/main.ts run
```

Guard currently covers health polling, local locks, sanitized snapshots, unreachable-gateway detection, and a restart foundation that stays disabled by default. It does not yet implement full staged updates, real rollback, runtime manifests, encrypted snapshots, service installation, or signed releases.

## Telegram Command Discovery

Telegram is optional for alpha.

Once configured, start with:

- `/help` for the flat command reference
- `/actions` or `/menu` for grouped operator actions
- `/examples` for copyable slash and freeform examples

Normal Telegram messages now have three behaviors:

- local state questions like `show projects` or `status` stay deterministic
- planning/spec/risk discussion becomes bounded chat
- concrete work requests become task proposals that still need `approve task`

Read-only discovery commands stay available during panic. Mutating commands like `/task`, `/approve`, and `/use-skill` do not.

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

OpenAI-style providers default to `gpt-4o-mini`. Some model IDs require account access. If validation fails, switch back to `gpt-4o-mini` or use a custom model name. OpenAI-compatible endpoints often need custom model IDs instead of the OpenAI preset list.

API-provider credentials can come from either:

- a pasted key stored locally in `~/.feather/.env.local`
- an existing environment variable such as `OPENAI_API_KEY`

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

In `v0.1.0-alpha`, filesystem reads are scoped to the registered project root and then blocked by secret patterns, always-blocked paths, and project deny patterns. `permissions.filesystem.read` entries are currently advisory and documentary; they are not enforced yet as a strict read allowlist. `permissions.filesystem.write` entries do affect write safety and approval behavior.

## Dashboard And Daemon

- `pnpm dev` starts the daemon, dashboard HMR, and Feather Guard in a separate supervisor process
- The daemon API serves on localhost only
- Built dashboard assets are served by the daemon after a production build

## Telegram Setup

Use onboarding if you want the simplest path. Feather also supports environment-variable setup:

1. Create a bot via [@BotFather](https://t.me/botfather).
2. Either paste the bot token during onboarding so Feather stores it in `~/.feather/.env.local`, or set `TELEGRAM_BOT_TOKEN` yourself.
3. Set allowed Telegram user IDs as numeric IDs, not `@handles`.
4. Restart the daemon if you added credentials after it was already running.

Useful commands include `/status`, `/projects`, `/task <project> <prompt>`, `/approvals`, `/approve <id>`, `/reject <id>`, `/panic`, `/resume confirm`, `/budget`, `/cancel <taskId>`, `/actions`, `/menu`, `/examples`, and `/help`.

Plain Telegram messages can now:

- answer local state without a provider
- hold a bounded planning conversation
- turn direct requests or recent conversation into a task proposal that waits for `approve task`

Telegram chat configuration lives under `telegram.chat` in `~/.feather/config.yml`:

```yaml
telegram:
  chat:
    enabled: true
    providerId: openai-mini
    maxContextMessages: 12
    maxOutputTokens: 700
```

Current alpha behavior:

- API providers (`openai`, `openrouter`, `openai-compatible`) can back Telegram chat through a chat-only call
- `codex-cli` remains local-only for Telegram chat in this alpha
- if no chat provider is configured, Feather falls back to local replies instead of failing silently
- Telegram operational messages are sent as plain text so Windows paths and backslashes do not break delivery

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
- [Guard runtime manifest design](docs/guard-runtime-manifest.md)
- [Guard update and rollback plan](docs/guard-update-rollback-plan.md)
- [Supervisor service story](docs/supervisor-service.md)
- [Snapshot security](docs/snapshot-security.md)
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
