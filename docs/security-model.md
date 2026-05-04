# Security Model

## Principles

1. **Default deny** — no tool action runs without explicit permission
2. **Project-scoped** — all tool calls are bounded to the registered project root
3. **Secret protection** — secret file patterns are always blocked regardless of config
4. **Shell guardrails** — dangerous shell patterns are blocked globally
5. **Approval queue** — risky actions must be approved by the user before execution
6. **Budget limits** — cost overruns are prevented before tasks start
7. **Panic mode** — instant lockdown available from dashboard, CLI, or Telegram

## Risk levels

| Level | Meaning |
|-------|---------|
| `safe` | Can auto-run if explicitly in allow list |
| `review` | Requires user approval |
| `dangerous` | Blocked unless project config explicitly permits with review |
| `blocked` | Never allowed |

## Secret deny patterns

Always blocked, regardless of project config:

```
.env, .env.*, *.pem, *.key, id_rsa, id_ed25519,
secrets.*, credentials.*, *.p12, *.pfx
```

## Shell deny patterns

Always blocked globally:

```
rm -rf *, sudo *, curl * | sh, wget * | sh,
powershell Invoke-Expression *, powershell iwr * | iex,
format *, del /s *, rmdir /s *
```

## Path safety

- All tool calls resolve inside the registered project root
- Path traversal (`../../`) is rejected
- `.git`, `node_modules` are always blocked

## Secrets in provider context

- Feather does not send `.env` or secret files to providers by default
- Context files must be explicitly listed by the user or agent
- `provider:send_context` is a gated permission scope

## Panic mode

Panic mode:
- Cancels all active tasks
- Pauses heartbeat
- Rejects pending risky approvals
- Blocks shell tool
- Logs the panic event

Activate with: `feather panic` or the dashboard Panic button.
Deactivate with: `feather resume`.
