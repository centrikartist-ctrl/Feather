# Guard Update And Rollback Plan

This document describes the intended staged update and rollback flow after `v0.1.0-alpha`.

Status: design only. Current alpha does not implement full staged update or rollback.

## Intended layout

```text
current/
previous/
staged/
```

## Future staged flow

1. Snapshot the current Feather home.
2. Build the staged runtime.
3. Run typecheck, build, and test on the staged runtime.
4. Run `/diagnostics/noop` against the staged gateway.
5. Promote `staged/` to `current/`.
6. Keep a `previous/` pointer.
7. Roll back to `previous/` if health fails.

## Constraints

- The main gateway can request an update.
- The supervisor performs the update.
- No update should run during panic or safe mode.
- Request JSON must not contain arbitrary commands.
- Signed release verification belongs to a later pass.

## Alpha position

`v0.1.0-alpha` keeps the simpler Guard foundation:

- local locks
- health polling and classification
- sanitized snapshots
- file-based lifecycle request queue foundation
- restart foundation disabled by default

That is enough for a supervised alpha, but not enough to claim automatic staged updates or real rollback.