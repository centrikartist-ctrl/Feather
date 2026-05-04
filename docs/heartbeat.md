# Heartbeat

Heartbeat is Feather's lightweight project observation loop.

## Modes

- `off`
- `manual`
- `passive`
- `proactive`
- `operator`

The default is `passive`.

## v0.1 behavior

Current heartbeat checks focus on:

- git dirty state
- pending approvals
- daily recap generation

Heartbeat writes observations into SQLite and exposes them to the dashboard and API.

## Constraints

Heartbeat must not:

- scan outside registered project roots
- read secrets
- silently execute risky commands
- generate expensive provider calls without control

## Output

Heartbeat produces structured observations with:

- severity
- title
- body
- suggested actions
