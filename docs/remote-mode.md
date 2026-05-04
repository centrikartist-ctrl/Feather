# Remote Mode

Full remote mode is out of scope for v0.1, but the architecture should not block it.

## Long-term shape

```text
Telegram / Browser
      ↓
Remote Feather Core
      ↓
Secure relay
      ↓
Local Project Runner
      ↓
Approved project roots only
```

## Principles

- the VPS should not directly expose the user's whole machine
- the local runner should expose only registered project roots
- requests should be signed and auditable
- offline laptops should degrade gracefully

The current v0.1 daemon, provider, and approval layers are structured so a local runner/remote core split can be added later.
