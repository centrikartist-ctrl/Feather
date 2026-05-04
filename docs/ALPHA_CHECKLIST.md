# Feather Alpha Checklist

## Safety

- [ ] Start daemon
- [ ] Activate panic
- [ ] Restart daemon
- [ ] Confirm panic still active
- [ ] Confirm task recovery is skipped during panic startup
- [ ] Resume
- [ ] Confirm heartbeat starts again

## Codex provider

- [ ] Validate Codex CLI provider
- [ ] Confirm args builder emits no dangerous auto-approval flags
- [ ] Start a Codex task
- [ ] Cancel the task
- [ ] Confirm process stops best-effort

## Approvals

- [ ] Trigger review-risk file write
- [ ] Confirm file is not written before approval
- [ ] Confirm approval payload contains diff preview
- [ ] Approve
- [ ] Confirm exact file write
- [ ] Trigger review-risk shell command
- [ ] Confirm approval required

## Telegram

- [ ] /status works
- [ ] /panic activates panic
- [ ] /task is blocked during panic
- [ ] /approve is blocked during panic
- [ ] /reject is allowed during panic
- [ ] /resume confirm resumes
- [ ] /cancel cancels task

## Budgets

- [ ] Configure provider without pricing
- [ ] Confirm budget mode is unknown
- [ ] Configure pricing
- [ ] Confirm budget mode is estimated
- [ ] Trigger usage event
- [ ] Confirm estimated spend is recorded