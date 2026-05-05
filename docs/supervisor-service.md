# Supervisor Service Story

This document describes how Feather Guard should become a real background service after `v0.1.0-alpha`.

Status: planning only. In `v0.1.0-alpha`, `pnpm dev` starts the supervisor alongside the daemon and dashboard, but service installation is not implemented.

## Alpha behaviour

`pnpm dev` is the normal local development entrypoint and launches Guard as a separate process.

You can also run Guard directly with the repo-local command:

```sh
pnpm --filter @feather/supervisor exec tsx src/main.ts run
```

Service installation is planned, not implemented.

## Platform direction

Windows:

- alpha: manual terminal run
- later: Windows Task Scheduler or a service wrapper

macOS:

- later: `launchd` plist

Linux:

- later: `systemd --user` service

## Requirements for a later pass

- explicit start/stop/status story
- clear log location
- crash restart policy that does not thrash during safe mode
- local-only configuration surface
- no natural-language execution channel through the supervisor service
