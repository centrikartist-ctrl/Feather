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
- [ ] Restart daemon
- [ ] Confirm panic still active
- [ ] Confirm task recovery is skipped during panic startup
- [ ] Confirm heartbeat does not start during panic startup
- [ ] Resume
- [ ] Confirm heartbeat starts again

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
- [ ] Confirm heartbeat stops during panic
- [ ] Confirm heartbeat resumes after resume
- [ ] Generate daily recap

## Docs

- [ ] README matches actual behaviour
- [ ] Known limitations are honest
- [ ] v0.2-only features are not claimed as v0.1