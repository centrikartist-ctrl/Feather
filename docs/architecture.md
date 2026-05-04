# Architecture

## Overview

```
CLI (feather)
     ↓
Core Daemon (Fastify, port 47383)
     ├── Project Service
     ├── Task Runner
     ├── Approval Service
     ├── Heartbeat Service
     ├── Provider Registry
     │     ├── Codex CLI Provider
     │     ├── OpenAI Provider
     │     ├── OpenAI-Compatible Provider
     │     └── OpenRouter Provider
     ├── Permission Service (per-project)
     ├── Budget Service
     ├── Panic Module
     └── SQLite DB (Drizzle ORM)
          └── ~/.feather/feather.db

Dashboard (Vite + React, port 5173 in dev)
     └── Served from apps/dashboard/
```

## Package layout

```
feather/
  apps/
    dashboard/   ← React UI (Vite)
    cli/         ← Commander CLI

  packages/
    shared/      ← Types, schemas, constants, errors
    core/        ← Daemon: DB, API, services, providers, tools
```

## Data flow: task execution

```
User → Dashboard / CLI
  → POST /tasks
    → BudgetService.checkDailyBudget()
    → TaskRunner.createTask()
    → TaskRunner.runTask() [background]
      → ProviderAdapter.startTask()
        → Streams ProviderEvents
      → TaskEvents persisted to SQLite
      → SSE broadcast to dashboard
  → GET /tasks/:id/stream (SSE)
```

## Data flow: approval

```
Tool action requires approval
  → ApprovalService.createApproval()
  → ApprovalRequiredError thrown
  → Dashboard shows approval card
  → User clicks Approve / Reject
    → POST /approvals/:id/resolve
      → Approval marked resolved
      → Task runner can continue
```

## Heartbeat

```
HeartbeatService.start(intervalMinutes)
  → Runs every N minutes
  → For each project:
    → git status check
    → pending approvals check
  → Persists Observations to DB
  → Dashboard shows Observations
```
