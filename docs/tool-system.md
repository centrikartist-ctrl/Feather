# Tool System

Feather v0.1 ships with built-in tools implemented inside `packages/core/src/tools`.

## Built-in tools

- filesystem read/write/list
- shell command execution
- git status/diff/branch/log

## Safety model

Every tool action passes through `PermissionService`.

Default-deny rules apply to:

- path traversal outside the registered project root
- secret file patterns like `.env`, `*.pem`, `*.key`
- always-blocked paths such as `.git` and `node_modules`
- shell deny patterns such as `rm -rf *` and `curl * | sh`

## Risk handling

Tool actions are classified as:

- `safe`
- `review`
- `dangerous`
- `blocked`

Risk is used to decide whether an action may run directly, requires approval, or is refused.

## Future direction

The spec leaves room for local manifest-based tools later, but there is no marketplace or remote plugin loading in v0.1.
