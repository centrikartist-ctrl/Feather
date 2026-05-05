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
