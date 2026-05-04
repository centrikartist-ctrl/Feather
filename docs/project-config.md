# Project Config

Each registered project owns a `.feather/` directory.

## Files

- `.feather/project.yml`
- `.feather/instructions.md`
- `.feather/heartbeat.yml` reserved for future expansion
- `.feather/budget.yml` reserved for future expansion

## `project.yml`

The project config controls:

- provider routing hints
- filesystem permissions
- shell allow/deny/review lists
- heartbeat defaults
- agent instruction behavior

## Ownership model

Project config is user-owned.

Feather may create a default config and may later suggest edits, but it should not silently rewrite the user's instructions or policy files.
