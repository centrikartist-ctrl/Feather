# Memory

Feather includes explicit editable memory in `v0.1.0-alpha`.

## Model

Each memory is:

- `global` or `project` scoped
- one of `preference`, `fact`, `decision`, `constraint`, or `workflow`
- visible, editable, and deletable

## Surfaces

- dashboard Memory page
- REST API: `GET/POST/PATCH/DELETE /memories`
- Telegram commands: `/memories`, `/save-memory`, `/forget-memory`

## Prompt behavior

Feather can include up to:

- 10 global memories
- 10 project memories

in the task system prompt.

## Safety

Memory is context only.

- it does not grant permissions
- it does not bypass panic
- it does not bypass approvals
- it does not override denied paths or secret blocking
- it is not hidden automatic memory
- it is not transcript storage
- it cannot override skill allowlists, provider routing, budget limits, safe mode, or Guard locks
