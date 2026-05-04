# Vision

Feather exists to make Codex and API-driven agent workflows usable on weak local machines.

## Goal

Provide a lightweight local harness with:

- project-scoped permissions
- approval-gated risky actions
- provider routing
- heartbeat observations and recaps
- a local dashboard and CLI

## Non-goals for v0.1

- local LLM hosting
- unrestricted autonomy
- browser automation
- plugin marketplace
- swarm orchestration
- desktop app packaging

## Product wedge

The retained workflow for v0.1 is:

```text
Add project -> send task -> route to provider -> approve risky actions -> inspect events -> heartbeat recap -> take next step
```

Everything in the codebase should strengthen that loop.
