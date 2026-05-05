# Telegram Freeform

Feather keeps all existing slash commands and adds deterministic freeform routing for plain Telegram messages in `v0.1.0-alpha`.

## What it handles

- read-only status questions
- approval responses
- panic and cancel intents
- task proposals that require confirmation

## What it does not do

- it does not use an LLM classifier
- it does not bypass approvals
- it does not auto-run risky work from plain text
- it does not silently choose between multiple projects
- it does not bypass panic, approval gates, denied paths, budgets, provider routing, memory safety, or skill allowlists

## Plain-message examples

- `status`
- `what's going on with Feather?`
- `any pending approvals?`
- `fix the provider pricing UI`
- `panic`
- `approve`
- `reject abc123`

## Task confirmation flow

Plain action requests create a pending proposal first.

Feather replies with:

- project
- provider
- risk hint
- prompt preview

The operator must reply with `approve task` or `cancel`.

## Current command additions

- `/help`
- `/actions`
- `/menu`
- `/examples`
- `/memories`
- `/save-memory global <text>`
- `/save-memory project <project> <text>`
- `/forget-memory <id>`
- `/skills`
- `/use-skill <project> <skill> <task prompt>`

## Panic behaviour

Allowed during panic:

- `/help`
- `/actions`
- `/menu`
- `/examples`
- `/status`
- `/projects`
- `/approvals`
- `/budget`
- `/recap <project>`
- `/reject <id>`
- `/cancel <taskId>`
- `/resume confirm`

Blocked during panic:

- `/task <project> <prompt>`
- `/approve <id>`
- `/use-skill <project> <skill> <task prompt>`
- plain task creation requests
- `heartbeat on`

## Manual Telegram test steps

1. Start Feather with Telegram configured.
2. Send `/help`, `/actions`, and `/examples` and confirm the command discovery output is readable.
3. Send `status` and confirm a read-only summary comes back.
4. Send a plain action request and confirm Feather asks for `approve task`.
5. Reply `approve task` and confirm the task appears in the dashboard.
6. Activate panic and confirm plain task approval is blocked while plain reject still works.

Live Telegram testing is manual because bot credentials are user-owned local secrets. The automated suite uses mocked Telegram transport.
