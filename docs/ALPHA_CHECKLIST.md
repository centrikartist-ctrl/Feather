# Feather Alpha Checklist

## Environment

- [ ] Node version matches README/package/CI
- [ ] pnpm version matches README/package/CI
- [ ] `pnpm install` succeeds
- [ ] `pnpm run check:repo-safety` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Supervisor typecheck/build/test pass

## Safety

- [ ] Start daemon
- [ ] Activate panic
- [ ] Confirm `panic.lock` is created
- [ ] Restart daemon
- [ ] Confirm panic still active
- [ ] Confirm task recovery is skipped during panic startup
- [ ] Confirm heartbeat does not start during panic startup
- [ ] Resume
- [ ] Confirm `panic.lock` is removed
- [ ] Confirm heartbeat starts again

## Feather Guard

- [ ] `GET /health` returns structured status and checks
- [ ] `POST /diagnostics/noop` passes without model calls or user project writes
- [ ] `panic.lock`, `maintenance.lock`, `update.lock`, and `safe-mode.lock` paths are local and file-based
- [ ] Supervisor `status` detects reachable gateway health
- [ ] Supervisor detects unreachable gateway
- [ ] Supervisor does not restart while `panic.lock` exists
- [ ] Supervisor enters safe mode after repeated hard failures
- [ ] Supervisor does not restart while `safe-mode.lock` exists
- [ ] Snapshot create writes sanitized files only
- [ ] Snapshot redacts YAML, dotenv, spaced assignment, and JSON-like secret lines
- [ ] Snapshot excludes `.env*`, credentials, keys, logs, DB smoke temp projects, snapshots, `.git`, `node_modules`, and build output
- [ ] Lifecycle request endpoint writes JSON request files and does not execute lifecycle actions directly
- [ ] Unknown lifecycle request types are rejected

## Manual alpha smoke

- [ ] `pnpm run setup` succeeds without requiring API keys or Telegram
- [ ] `feather doctor` reports clear warnings when providers or projects are missing
- [ ] Start daemon
- [ ] Open dashboard
- [ ] Configure provider
- [ ] Add project
- [ ] Run simple task
- [ ] Trigger approval
- [ ] Approve and reject approval paths
- [ ] Panic and resume
- [ ] Confirm `panic.lock` creation/removal
- [ ] `GET /health`
- [ ] `POST /diagnostics/noop`
- [ ] `feather-supervisor status`
- [ ] `feather-supervisor snapshot create "manual alpha check"`
- [ ] Telegram `/status` if configured
- [ ] Plain Telegram `status` if configured

## Codex provider

- [ ] Validate Codex CLI provider
- [ ] Confirm args builder emits no dangerous auto-approval flags
- [ ] Start a Codex task
- [ ] Cancel the task
- [ ] Confirm process stops best-effort
- [ ] Confirm task logs cancellation clearly

## Provider routing

- [ ] Create task with explicit provider
- [ ] Create task with project provider
- [ ] Create task with global default
- [ ] Confirm missing provider gives actionable error
- [ ] Confirm no silent first-provider fallback unless auto-route enabled

## API provider live smoke

- [ ] Validate `gpt-4o-mini` or another mini-tier API provider
- [ ] Run one exact-text smoke task
- [ ] Run one auto-route smoke task
- [ ] Run one cancellation smoke task
- [ ] Run one review-gated write task and approve it
- [ ] Run one review-gated write task and reject it

## Approvals

- [ ] Trigger review-risk file write
- [ ] Confirm file is not written before approval
- [ ] Confirm approval payload contains diff preview
- [ ] Approve
- [ ] Confirm exact file write
- [ ] Modify file between preview and approval
- [ ] Confirm stale write is blocked
- [ ] Trigger review-risk shell command
- [ ] Confirm approval required
- [ ] Reject an approval
- [ ] Confirm rejected action does not execute

## Telegram

- [ ] `/status` works
- [ ] `/projects` works
- [ ] `/projects` still works with Windows paths
- [ ] `/help` works
- [ ] `/actions` or `/menu` works
- [ ] `/examples` works
- [ ] plain `status` works
- [ ] plain `show projects` works
- [ ] `hello` gets a conversational reply
- [ ] `what can you do?` gets a conversational reply
- [ ] no configured chat provider falls back to local Telegram reply
- [ ] plain task request creates a confirmation instead of a task
- [ ] plain task request with multiple projects asks which project to use
- [ ] plain task request with one project creates a pending proposal
- [ ] `do it` turns recent conversation into a pending proposal
- [ ] `approve task` starts the proposed task
- [ ] `cancel` clears the pending Telegram proposal
- [ ] `edit: ...` updates the pending Telegram proposal
- [ ] `/clear-chat` clears the in-memory Telegram session
- [ ] `/memories` works
- [ ] `/save-memory global <text>` works
- [ ] `/skills` works
- [ ] `/use-skill <project> <skill> <task prompt>` works
- [ ] /panic activates panic
- [ ] /task is blocked during panic
- [ ] /approve is blocked during panic
- [ ] /help is allowed during panic
- [ ] /actions or /menu are allowed during panic
- [ ] /examples is allowed during panic
- [ ] conversational planning still works during panic
- [ ] `approve task` is blocked during panic
- [ ] /reject is allowed during panic
- [ ] /resume confirm resumes
- [ ] /cancel cancels task
- [ ] approval notification arrives compactly
- [ ] no giant diff is sent to Telegram
- [ ] no Telegram message silently disappears on formatting-sensitive content

## Budgets

- [ ] Configure provider without pricing
- [ ] Confirm budget mode is unknown
- [ ] Configure pricing
- [ ] Confirm budget mode is estimated
- [ ] Trigger usage event
- [ ] Confirm estimated spend is recorded
- [ ] Confirm cumulative task budget stop works where pricing exists

## Heartbeat

- [ ] Run heartbeat twice
- [ ] Confirm duplicate observations are deduped
- [ ] Confirm off mode suppresses runs
- [ ] Confirm manual mode runs only on manual trigger
- [ ] Confirm proactive mode adds suggested actions but does not create tasks
- [ ] Confirm quiet hours suppress scheduled runs
- [ ] Confirm heartbeat instructions appear in recap output
- [ ] Confirm explicit memory can influence recap wording without bypassing safety
- [ ] Confirm heartbeat stops during panic
- [ ] Confirm heartbeat resumes after resume
- [ ] Generate daily recap

## Memory

- [ ] Create global memory
- [ ] Create project memory
- [ ] Edit memory
- [ ] Delete memory
- [ ] Confirm prompt builder includes memory context
- [ ] Confirm memory does not bypass approval-gated tool paths

## Skills

- [ ] Load global skill
- [ ] Load project skill
- [ ] Create task with selected skill
- [ ] Confirm prompt builder includes selected skill
- [ ] Confirm disallowed tool is blocked when a skill is selected
- [ ] Confirm skill does not expand permissions

## Live API smoke (`gpt-4o-mini`)

- [ ] Validate provider
- [ ] Exact-text smoke task passes
- [ ] Review-gated write approve passes
- [ ] Review-gated write reject passes
- [ ] Cancellation smoke passes
- [ ] Budget estimate smoke passes
- [ ] Panic/resume smoke passes

## Docs

- [ ] README matches actual behaviour
- [ ] Known limitations are honest
- [ ] README separates local use, development, Guard, and Telegram discovery
- [ ] Telegram freeform doc matches actual deterministic routing
- [ ] Memory doc matches explicit-only behavior
- [ ] Skills doc states that skills do not grant permissions

## v0.1.0-alpha tag checklist

- [ ] `pnpm install` succeeds
- [ ] `pnpm run check:repo-safety` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm run smoke:live:gpt-4o-mini` passes if API key is present
- [ ] README says public alpha, not production
- [ ] README package table includes supervisor
- [ ] Guard limitations are explicit
- [ ] Snapshot redaction/exclusion tests pass
- [ ] `/health` manual check passes
- [ ] `/diagnostics/noop` manual check passes
- [ ] supervisor status manual check passes
- [ ] supervisor snapshot create manual check passes
- [ ] no `.env*`, credentials, DBs, logs, snapshots, or temp projects staged
- [ ] `git status --short --ignored` reviewed
- [ ] tag only after user approval
