# What Feather Is and Is Not

## What Feather is

Feather is a lightweight, open-source, local web dashboard and daemon harness for running Codex/API-powered agent workflows on weak machines.

The current v0.1 target is a local operator build for supervised use. It is not a finished desktop product, and some provider and approval flows are still being tightened.

- A local daemon
- A local web dashboard (`http://localhost:5173` in development; built assets can be served by the daemon)
- A CLI (`feather`)
- A project registry
- A provider router (Codex CLI, OpenAI, OpenRouter, OpenAI-compatible)
- A permissioned tool runner
- A heartbeat engine
- An approval queue
- A daily recap system
- A user-owned agent configuration layer

## What Feather is not

- A local LLM runtime
- A replacement for Codex
- A clone of OpenClaw or Hermes
- A desktop-control everything agent
- A browser automation product
- An AI companion or personality toy
- A plugin marketplace
- A voice assistant
- A polished unattended agent platform
- An unrestricted autonomous system
- A tool that silently reads the whole machine
- A tool that silently executes destructive commands
- A tool that sends secrets to models by default

## Core thesis

> Codex with a good harness is elite. Feather is the lightweight harness for people who do not have workstation hardware and do not want a huge always-on agent stack.
