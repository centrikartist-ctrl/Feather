# Guard Runtime Manifest Design

This document describes the intended runtime manifest shape for Feather Guard after `v0.1.0-alpha`.

Status: design only. Not implemented as enforcement yet.

## Purpose

The runtime manifest should help Guard:

- know what runtime is active
- support future staged updates
- support rollback eligibility checks
- detect mismatched builds
- avoid supervisor guessing

## Proposed shape

```ts
type RuntimeManifest = {
  version: string;
  buildId: string;
  createdAt: string;
  gitCommit?: string;
  packageManager: "pnpm";
  nodeRange: string;
  entrypoints: {
    gateway: string;
    supervisor: string;
    cli: string;
  };
  checksums?: Record<string, string>;
  migrations?: {
    dbSchemaVersion?: string;
  };
};
```

## Alpha position

`v0.1.0-alpha` does not enforce a runtime manifest yet.

That means Guard still relies on health checks, locks, sanitized snapshots, and manual operator judgment rather than a signed or verified runtime description.

## Future use

The likely sequence is:

1. Build a runtime artifact.
2. Emit a manifest alongside it.
3. Let the supervisor compare the manifest before promotion.
4. Use manifest compatibility checks before rollback or migration steps.

## Constraints

- The gateway can request lifecycle actions, but it should not write or bless the manifest for its own runtime.
- The supervisor should read and compare manifests, not improvise runtime guesses.
- Manifest validation should remain deterministic and local.