# Provider Adapters

Feather v0.01 currently supports four provider types:

- `codex-cli`
- `openai`
- `openai-compatible`
- `openrouter`

## Adapter contract

Each provider implements the shared adapter interface:

- `validateConfig()`
- `startTask()`
- `cancelTask()`
- capability flags for streaming, tool support, coding, and cost estimation

## Codex CLI

The Codex provider spawns the configured `codex` command inside the project root and streams output back into task events.

It also loads:

- `.feather/instructions.md`
- `AGENTS.md`

Validation runs `codex --version`.

## OpenAI-compatible family

`openai`, `openrouter`, and `openai-compatible` use the same streaming chat-completions path with different defaults.

In the current build, these providers do not use native provider tool-calling. Feather injects a small text-based tool protocol so the model can request filesystem, shell, and git actions through the task runner when the model follows that format.

The parser is intentionally strict:

- exactly one `feather_tool` block
- valid JSON only
- tool name must be on Feather's allowlist
- oversized protocol blocks are rejected
- extra prose around a tool block is rejected

That means:

- simple text tasks are reliable
- validation and budget estimation work as expected when usage/pricing data are available
- tool-heavy tasks work, but they should still be treated as supervised flows rather than unattended automation

Configuration fields:

- `apiKeyEnv`
- `model`
- `baseUrl` where applicable
- `maxTaskCents` optional

## Persistence

Provider configs are stored in SQLite in `provider_configs` and loaded into the in-memory registry on daemon startup.
