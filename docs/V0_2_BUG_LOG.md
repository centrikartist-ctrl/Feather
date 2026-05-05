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