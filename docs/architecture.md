# Architecture

## Overview

```text
Feather Guard Supervisor
  - polls gateway health
  - reads locks
  - creates sanitized snapshots
  - can attempt configured restart only when enabled

        watches
           |
           v

Core Daemon / Gateway
  - Fastify API on localhost
  - dashboard asset serving after build
  - project registry
  - provider registry
  - task runner
  - approval service
  - permission service
  - budget service
  - heartbeat service
  - panic module
  - explicit memory
  - local skills
  - optional Telegram connector

        runs gated tasks through
           |
           v

Providers / Tools / Projects
  - Codex CLI
  - OpenAI
  - OpenRouter
  - OpenAI-compatible endpoints
  - filesystem, shell, and git tools
```

The supervisor is not a second agent. It does not chat, browse, call models, accept natural-language tasks, or work on user projects.

## Telegram Conversation Flow

```text
Telegram message
  -> slash command?
    -> deterministic command path
  -> local state question?
    -> deterministic local reply
  -> direct work request?
    -> create pending task proposal
    -> wait for approve task / edit: ... / cancel
  -> otherwise
    -> bounded planning chat
     -> optional API-provider chat-only response
     -> never tools, shell, file writes, or task execution
```

Telegram conversation state is in-memory only in `v0.1.0-alpha`. It is bounded, expires after inactivity, and is not written into Feather memory automatically.

## Package Layout

```text
feather/
  apps/
    cli/          feather CLI
    dashboard/    React dashboard
    supervisor/   Feather Guard supervisor MVP

  packages/
    shared/       types, schemas, constants, errors
    core/         daemon, DB, API, services, providers, tools
```

## Task Execution Flow

```text
User -> Dashboard / CLI / Telegram
  -> POST /tasks
    -> provider routing
    -> budget checks
    -> TaskRunner.createTask()
    -> TaskRunner.runTask()
      -> ProviderAdapter.startTask()
      -> ProviderEvents persisted as task events
      -> Tool requests go through panic, permissions, approvals, and budgets
  -> GET /tasks/:id/stream for dashboard event streaming
```

## Approval Flow

```text
Tool action requires approval
  -> ApprovalService.createApproval()
  -> dashboard and Telegram can show approval
  -> user approves or rejects
  -> approved action continues through TaskRunner
```

Approvals cannot bypass panic. Rejection remains allowed during panic so risky work can be blocked.

Telegram chat-originated work uses the same approval and routing model after the operator explicitly approves the proposal. Chat does not bypass TaskRunner gates.

## Guard Flow

```text
Supervisor tick
  -> read panic / maintenance / update / safe-mode locks
  -> poll GET /health
  -> optionally POST /diagnostics/noop
  -> classify health
  -> restart only if explicitly configured and not in panic/safe mode
  -> enter safe mode after repeated hard failures
```

Guard MVP does not yet implement full staged updates, real rollback, runtime manifests, signed releases, encrypted snapshots, OS-level user separation, or service installation.

## Heartbeat

```text
HeartbeatService.start()
  -> runs according to mode and interval
  -> checks git dirty state, pending approvals, and daily recap signals
  -> writes observations to SQLite
  -> proactive mode can suggest actions but does not auto-start tasks
```
