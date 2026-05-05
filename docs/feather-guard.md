# Feather Guard

Feather Guard is the external supervisor layer for Feather. It is intentionally narrow: it watches the gateway, classifies health, manages local lifecycle locks, creates snapshots, and can attempt a configured gateway restart.

It does not chat, browse, call models, edit user projects, install plugins, run updates from natural language, or bypass Feather approvals.

## Gateway Health

The gateway exposes:

```http
GET /health
POST /diagnostics/noop
```

`/health` returns structured status with:

- `status`: `healthy`, `degraded`, `critical`, `maintenance`, or `safe_mode`
- `checks`: database, provider registry, task runner, tool registry, memory, skills, logs, and Telegram unknown status
- lock state for `panic.lock`, `maintenance.lock`, `update.lock`, and `safe-mode.lock`
- task runner counters and panic state

`/diagnostics/noop` is sealed and local. It does not call models, touch user projects, send Telegram messages, run shell, or trigger normal agent reasoning.

## Locks

Guard uses file locks under Feather home:

```text
locks/panic.lock
locks/maintenance.lock
locks/update.lock
locks/safe-mode.lock
```

Panic is now integrated with `panic.lock`. When panic is active, the gateway blocks new work and active tasks are cancelled through the existing task runner path. The supervisor treats panic as a hard stop and does not restart or update the gateway while the panic lock exists.

## Lifecycle Requests

The gateway may write lifecycle requests, but it does not perform lifecycle actions directly:

```http
POST /lifecycle/requests
```

The request is written to Feather home `requests/` as JSON. This is only a queue foundation in this pass. The alpha allowlist is:

- `RESTART_REQUEST`
- `PANIC_REQUEST`
- `SNAPSHOT_REQUEST`

Unknown request types are rejected. The supervisor does not yet process queued requests into lifecycle actions and does not perform staged updates from those requests.

## Supervisor

The separate app lives at:

```text
apps/supervisor
```

Commands after build:

```sh
feather-supervisor run
feather-supervisor status
feather-supervisor snapshot create "reason"
```

The supervisor polls the gateway, optionally runs noop diagnostics, classifies health, detects unreachable gateway, attempts a configured restart after repeated unreachable checks, and enters safe mode after repeated hard failures.

Gateway restart is disabled by default. Only configure restart commands you trust. The supervisor does not accept restart commands from chat, model output, lifecycle requests, or the gateway. If configured, restart uses explicit command plus argv with `shell: false`; there is no chat or freeform command execution surface.

If `safe-mode.lock` exists, the supervisor does not keep restarting the gateway. Manual intervention is required.

## Snapshots

Snapshots are written under Feather home `snapshots/` by default.

Included:

- sanitized `config.yml`
- `agent.md`
- local Feather DB files when present
- Feather home `memory/` and `skills/` when present
- runtime `package.json`
- runtime `pnpm-lock.yaml`

Excluded:

- `.env*`
- credentials/secrets files
- private key/cert files
- logs
- `node_modules`
- `dist`
- `.git`
- snapshots

Sensitive config lines containing token, API key, secret, or password are redacted before copy. Redaction covers common YAML, dotenv, spaced assignment, and JSON-like forms, but secrets should still live outside snapshot inputs wherever practical.

## Current Limits

This is an MVP, not production rollback safety.

- No staged update implementation yet.
- No rollback implementation yet.
- No runtime manifest protection yet.
- No signed releases.
- No encrypted snapshots.
- No OS-level separate user or ACL hardening.
- No Telegram live testing in the supervisor.
- Gateway `/resume` still exists for current product continuity; full external-only panic unlock should be tightened in a later pass.
