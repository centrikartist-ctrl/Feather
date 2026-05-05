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

## Filesystem permissions in `v0.1.0-alpha`

Example:

```yaml
permissions:
	filesystem:
		read: ["."]
		write: ["src", "docs", "tests"]
		deny: [".env", ".env.*", "node_modules", ".git", "*.pem", "*.key"]
```

Current alpha behavior is intentionally narrower than a full policy engine:

- reads are scoped to the registered project root
- reads are blocked by secret patterns, always-blocked paths, and `filesystem.deny`
- `filesystem.read` entries are currently advisory and documentary, not a strict enforced read allowlist
- `filesystem.write` entries do affect write safety and approval behavior

If you want stricter reads today, use a smaller project root plus `filesystem.deny` patterns. Strict `filesystem.read` allowlist enforcement is planned as future hardening.

## Ownership model

Project config is user-owned.

Feather may create a default config and may later suggest edits, but it should not silently rewrite the user's instructions or policy files.
