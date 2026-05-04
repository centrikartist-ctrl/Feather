# Provider Adapters

Feather v0.1 supports four provider types:

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

Configuration fields:

- `apiKeyEnv`
- `model`
- `baseUrl` where applicable
- `maxTaskCents` optional

## Persistence

Provider configs are stored in SQLite in `provider_configs` and loaded into the in-memory registry on daemon startup.
