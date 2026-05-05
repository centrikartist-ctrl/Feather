# Heartbeat

Heartbeat is Feather's lightweight project observation loop.

## Modes

- `off`
- `manual`
- `passive`
- `proactive`

The default is `passive`.

## Current v0.01 behavior

Current heartbeat checks focus on:

- git dirty state
- pending approvals
- daily recap generation

Project heartbeat settings can now include:

- enable/disable
- mode
- interval minutes
- quiet hours
- per-check cooldowns
- recap instructions

Heartbeat writes observations into SQLite and exposes them to the dashboard and API.

In `proactive` mode, heartbeat can attach suggested actions to observations. It still does not start risky work automatically.

## Constraints

Heartbeat must not:

- scan outside registered project roots
- read secrets
- silently execute risky commands
- generate expensive provider calls without control
- use memory to bypass safety controls

## Output

Heartbeat produces structured observations with:

- severity
- title
- body
- suggested actions

Daily recaps can include:

- heartbeat instructions from project config
- explicit memory snippets as recap context

Those recap inputs are descriptive only. They do not grant permissions.
