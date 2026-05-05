# Telegram Freeform

Feather `v0.1.0-alpha` now treats Telegram as four layers instead of a command bot with a canned fallback:

- deterministic slash commands for hard control
- deterministic local-state replies for plain status-style questions
- bounded conversational planning chat
- explicit task proposal confirmation before any new chat-originated task is created

## Hard command/control layer

These paths stay deterministic and do not call a model:

- `/panic`
- `panic`
- `/resume confirm`
- `/cancel <taskId>`
- `/approve <id>`
- `/reject <id>`
- `/status`
- `/help`
- `/actions`
- `/menu`
- `/examples`
- `/projects`
- `/approvals`
- `/budget`
- `/clear-chat`

## Local state layer

Plain messages that clearly ask for local state are answered locally without a provider:

- `show projects`
- `list projects`
- `what projects are registered?`
- `any pending approvals?`
- `show approvals`
- `status`
- `budget`
- `what is running?`
- `panic state`

## Conversational planning layer

Everything that is not a command, a local-state intent, or a direct task request becomes conversation.

Examples:

- `hello`
- `what can you do?`
- `help me think through Feather`
- `how should I use this for VeriLabs?`
- `what should we build next?`
- `spec this idea`
- `challenge this plan`
- `what are the risks?`
- `how do we turn this into a task?`

This layer is chat-only:

- no tools
- no shell
- no file writes
- no approvals
- no task execution
- no repo file reads

Bounded chat context includes only:

- panic active/inactive
- project names and IDs
- pending approval count
- provider availability summary
- a tiny bounded explicit-memory summary when available
- recent Telegram messages from the current in-memory session

It does not include repo files, logs, raw config, DB contents, secrets, or task payloads.

## Provider-backed chat

Preferred config shape:

```yaml
telegram:
	chat:
		enabled: true
		providerId: openai-mini
		maxContextMessages: 12
		maxOutputTokens: 700
```

Provider behavior in the current build:

- `openai`, `openrouter`, and `openai-compatible` can answer Telegram chat through a chat-only provider call
- Feather does not enable the text-based `feather_tool` protocol in Telegram chat mode
- `codex-cli` stays local-only for Telegram chat in this alpha; Codex remains available for normal Feather tasks
- if no Telegram chat provider is configured, Feather falls back to local helpful replies instead of failing silently

## Task proposal flow

Chat-originated work never starts silently.

When the user asks for work in plain Telegram text, Feather creates a proposal first and replies with:

- title
- project
- provider
- risk hint
- prompt preview
- `Reply approve task or edit: <new instruction> or cancel.`

If the project is ambiguous, Feather asks which project to use before creating the proposal.

If the user says `do it`, `go ahead`, `create the task`, or similar after planning in chat, Feather summarizes the recent conversation into a proposal and then asks for confirmation.

## Conversation sessions

Telegram conversation sessions are:

- in memory only
- bounded by `telegram.chat.maxContextMessages`
- expired after 2 hours of inactivity
- never written into Feather memory automatically

Use `/clear-chat` or `clear chat` to discard the current session and any pending Telegram task proposal.

## Formatting safety

Telegram operational messages are now sent as plain text instead of Markdown-formatted messages.

This avoids silent drops from Windows paths, underscores, backslashes, model IDs, and other characters that can break Telegram Markdown parsing.

## Panic behavior

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
- local state questions
- conversational planning and explanation

Blocked during panic:

- `approve task`
- plain task proposal creation
- `/approve <id>`
- `/use-skill <project> <skill> <task prompt>`
- any new work execution path

When the user discusses future work during panic, Feather replies that it can discuss the plan but cannot create or approve work until panic is resumed.

## Safety boundaries preserved

- Telegram chat does not bypass panic
- Telegram chat does not bypass approvals
- Telegram chat does not bypass project permissions
- Telegram chat does not bypass budgets
- Telegram chat does not bypass provider routing for real tasks
- Telegram chat does not auto-run write, shell, or git work
- Telegram chat does not create hidden long-term memory

## Manual Telegram test steps

1. Start Feather with Telegram configured.
2. Send `/help`, `/actions`, and `/examples`.
3. Send `hello` and `what can you do?`.
4. Send `show projects` and `/projects`.
5. Send `help me plan a docs polish pass`.
6. Send `do it`.
7. Send `approve task`.
8. Send `create a small note in docs saying Telegram alpha test worked`.
9. Send `panic`.
10. While panic is active, send `help me plan a task for later` and then `approve task`.
11. Send `/resume confirm`.

Live Telegram testing remains manual because bot credentials are user-owned local secrets. The automated suite uses mocked Telegram transport.
