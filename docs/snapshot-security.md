# Snapshot Security

This document describes the current snapshot safety posture and the likely next hardening steps.

Status: current alpha behaviour plus future design.

## Current alpha

- snapshots are sanitized and redacted
- secret files are excluded
- snapshots are not encrypted
- snapshots should stay local and be treated as sensitive material

Current exclusions and redaction are meant to reduce obvious leakage, not to make snapshots safe for broad sharing.

## Future hardening candidates

- optional passphrase encryption
- OS keychain integration
- `age` or `sops` style encryption evaluation
- snapshot retention policy
- manual restore verification before promotion

## Alpha position

`v0.1.0-alpha` should not claim encrypted snapshots. The product truth is narrower: sanitized local snapshots for supervised recovery workflows.