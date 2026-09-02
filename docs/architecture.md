# Architecture Decisions — Workspace Launcher

Cheap-now, expensive-later decisions. Each one changes how code is shaped,
none of them add scope to Tier 1's feature list.

## 1. OS Abstraction Layer

Build a shared interface now; implement macOS only for v1.

```
/platform
  index.ts          → detects OS, returns correct implementation
  types.ts          → shared interface (launchApp, positionWindow, openTerminal, ...)
  /macos
    launcher.ts      → real AppleScript / `open -a` code
  /windows           → does not exist yet, added when actually building Windows support
```

Rest of the app (orchestrator, UI, config parser) calls the generic
`platform` interface only — never OS-specific code directly. When Windows
support is eventually built, only a new `/platform/windows/launcher.ts`
is needed; nothing else changes.

## 2. Plugin-Style Tool Registry

Each tool type (VS Code, Docker, Terminal, Chrome, Spotify, Slack, ...) is
a self-contained module with a consistent shape:
- `run(params)` — executes the step
- `validate(params)` — checks config is well-formed
- `teardown(params)` — reserved for Tier 2, can be a no-op for now

Adding a new tool type later means adding a new module, not editing a
growing if/else or switch statement in the orchestrator.

## 3. Config Schema Versioning

Every workspace config JSON includes a `version` field from day one.
Costs nothing now. When the config shape changes later (e.g. Tier 2
teardown steps), version detection allows migration instead of silent
breakage on old configs.

## 4. Standardized Step Result Shape

Every step (regardless of tool type) returns the same result shape:

```json
{ "success": true, "message": "...", "durationMs": 1234 }
```

Makes retry/status UI trivial to build consistently across all tool types,
instead of special-casing each one.

## Rule

These are structural decisions only. They do not expand what gets built
for Tier 1 — only how it's shaped. Do not add further architecture
decisions mid-build without checking against this doc first.
