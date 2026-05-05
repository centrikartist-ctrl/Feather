# Feather Alpha Checklist

## Environment

- [ ] Node version matches README/package/CI
- [ ] pnpm version matches README/package/CI
- [ ] `pnpm install` succeeds
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes

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
- [ ] Snapshot create writes sanitized files only
- [ ] Snapshot excludes `.env*`, credentials, keys, logs, DB smoke temp projects, `node_modules`, and build output
- [ ] Lifecycle request endpoint writes JSON request files and does not execute lifecycle actions directly

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
- [ ] plain `status` works
- [ ] plain task request creates a confirmation instead of a task
- [ ] `approve task` starts the proposed task
- [ ] `/memories` works
- [ ] `/save-memory global <text>` works
- [ ] `/skills` works
- [ ] `/use-skill <project> <skill> <task prompt>` works
- [ ] /panic activates panic
- [ ] /task is blocked during panic
- [ ] /approve is blocked during panic
- [ ] /reject is allowed during panic
- [ ] /resume confirm resumes
- [ ] /cancel cancels task
- [ ] approval notification arrives compactly
- [ ] no giant diff is sent to Telegram

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
- [ ] Telegram freeform doc matches actual deterministic routing
- [ ] Memory doc matches explicit-only behavior
- [ ] Skills doc states that skills do not grant permissions
