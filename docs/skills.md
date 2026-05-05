# Skills

Feather now supports local Markdown workflow packs called skills in this still-early v0.01 build.

## Locations

- `~/.feather/skills/`
- `<project>/.feather/skills/`

## Purpose

Skills narrow how a task should run.

They can describe:

- purpose
- allowed tools
- instructions
- expected output

## Task behavior

- selected skills are included in the task system prompt
- selected skills do not grant permissions
- tools outside the selected skill allowlist are blocked before execution
- project permissions, denied paths, approvals, budgets, and panic still win

## Surfaces

- dashboard Skills page
- REST API: `GET/POST/PATCH/DELETE /skills`
- Telegram commands: `/skills`, `/use-skill`