# Current Bug Log

## Template

### Title
Category:
Severity:
Status:
Steps to reproduce:
Expected:
Actual:
Fix:
Tests:

## Current entries

### `/diagnostics/noop` rejected PowerShell empty POST
Category: Guard
Severity: release-blocking alpha UX
Status: fixed
Steps to reproduce: run `Invoke-RestMethod -Uri "http://127.0.0.1:47383/diagnostics/noop" -Method POST`.
Expected: noop diagnostics should accept an empty local POST and return structured diagnostics.
Actual: Fastify returned unsupported media type for the PowerShell request.
Fix: accepted empty form-style POSTs while keeping diagnostics sealed and non-mutating.
Tests: guard API tests cover empty POST and JSON POST.

### Default docs writes bypassed approval
Category: approvals
Severity: release-blocking safety
Status: fixed
Steps to reproduce: ask the dashboard to create `docs/alpha-manual-test.md` under default project config.
Expected: file writes should require approval with diff preview.
Actual: default `filesystem.write` paths were treated as safe writes.
Fix: alpha write scope is now review-gated. Writes inside configured scope require approval; writes outside scope are blocked.
Tests: permission and task-runner approval tests.

### Guard snapshot crashed on busy files or overlap
Category: Guard
Severity: release-blocking reliability
Status: fixed
Steps to reproduce: run manual snapshot while Feather is active or start two snapshots quickly.
Expected: no overlapping snapshot chaos; busy files retry or skip with warnings.
Actual: Windows `EBUSY` on files such as `agent.md` could crash the command.
Fix: added `snapshot.lock`, unique snapshot IDs, busy-file retry/backoff, and skip-with-warning metadata.
Tests: supervisor snapshot lock and busy-file tests.

### Dashboard task output was hard to find
Category: UX
Severity: release-blocking alpha UX
Status: fixed for alpha minimum
Steps to reproduce: submit a dashboard Quick Task and try to see the response.
Expected: the operator can inspect prompt, status, events, output, errors, and approvals.
Actual: tasks appeared in a list with no detail view.
Fix: Quick Task navigates to task detail; task cards open detail; detail shows output, errors, event log, and approvals.
Tests: dashboard build.

### Alpha docs still used v0.01 wording
Category: docs
Severity: release-blocking
Status: fixed
Steps to reproduce: read README and subsystem docs before the public alpha prep pass.
Expected: docs should describe `v0.1.0-alpha` plainly without production claims or self-undermining language.
Actual: several pages still said v0.01 or omitted the supervisor package.
Fix: updated README, architecture, provider, Telegram, memory, skills, heartbeat, roadmap, Guard docs, and checklist language.
Tests: docs review plus full validation.

### Snapshot redaction missed common assignment styles
Category: Guard
Severity: safety
Status: fixed
Steps to reproduce: snapshot a config file containing `OPENAI_API_KEY=...` or JSON `"apiKey": "..."`.
Expected: snapshot copies should redact common secret assignment styles.
Actual: redaction only caught colon-style secret lines.
Fix: added redaction for dotenv, YAML, spaced assignment, and JSON-like key/value lines.
Tests: supervisor snapshot tests.

### Supervisor could keep restarting while safe mode was locked
Category: Guard
Severity: safety
Status: fixed
Steps to reproduce: create `safe-mode.lock` and run a supervisor tick with restart configured.
Expected: safe mode should stop restart thrashing.
Actual: supervisor only short-circuited on `panic.lock`.
Fix: supervisor now returns `safe_mode` immediately when `safe-mode.lock` exists.
Tests: supervisor safe-mode test.

### Dashboard task form lacked skill selection
Category: UX
Severity: medium
Status: fixed
Steps to reproduce: open the dashboard and try to create a task with a selected skill.
Expected: the task form should allow choosing a skill.
Actual: only project and provider could be selected.
Fix: added skill selection to the existing quick-task form and surfaced skills in the dashboard.
Tests: dashboard build, task-runner skill prompt/enforcement tests.

### Heartbeat config was too shallow for cooldowns and recap instructions
Category: heartbeat
Severity: medium
Status: fixed
Steps to reproduce: try to configure per-check cooldowns or recap instructions.
Expected: project heartbeat settings should support cooldowns and instructions.
Actual: only basic mode and booleans were available.
Fix: normalized heartbeat config, project update API, dashboard editor, and recap context support.
Tests: heartbeat tests for off/manual/proactive/quiet-hours/recap context.

### API provider tool protocol accepted ambiguous tool responses
Category: provider
Severity: safety
Status: fixed
Steps to reproduce: return malformed or mixed prose plus `feather_tool` output.
Expected: parser should reject ambiguous protocol output.
Actual: earlier parser accepted the first block loosely.
Fix: enforced one block, valid JSON, allowlisted tool names, size caps, and no extra prose around the tool block.
Tests: provider-validation parser tests.
