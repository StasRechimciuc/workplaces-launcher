# Workspace Launcher — Build Shell

## Tier 1 — v1 (build now)

### Core
- [x] Define workspace config format (JSON) — `WorkspaceConfigSchema` (`packages/shared/src/config-schema.ts`)
- [x] Config holds ordered list of steps
- [x] Each step: tool type + params
- [x] App reads config, runs steps in order — `orchestrator.ts`, platform-agnostic; unit-tested on macOS/Windows both, real end-to-end manual run on Windows still pending (blocked on VM access, see claude.md's 2026-09-17 note)
- [x] Simple UI: workspace list + detail — real, not mocked (persisted configs + create/edit/delete)

### Step types to support
- [x] VS Code — open folder path (plus optional terminal/command restore via the companion extension, below)
- [ ] Terminal — open pane(s), run command(s) as its own standalone step type (distinct from the VS Code step's narrower terminal restore, which is scoped to that step only)
- [ ] Docker — run compose/tilt command
- [x] Chrome — open profile + URLs
- [x] Spotify — open playlist URI
- [ ] Slack — open channel deep link

### VS Code companion extension
- [x] Scaffold extension (yo code)
- [x] Extension reads config on activation — `onStartupFinished`, plus a window-refocus listener and a manual "Restore Terminals" command for the two gaps startup activation alone can't cover
- [x] Create terminal(s) via `createTerminal()`
- [x] Run commands via `terminal.sendText()`
- [x] Position terminals — fixed to the editor's Panel location (`TerminalLocation.Panel`); a user-facing editor-vs-panel choice was never on the approved scope
- Handoff is a versioned, TTL-expiring per-folder file in a shared app-data directory (`packages/shared/src/vscode-restore.ts`), not IPC — see `WCs/WC__project-status.md` for the full design writeup

### Orchestrator logic
- [ ] Shell out for CLI tools (Docker, git) — `lib/shell-exec.ts`'s `runCommand`/`runDetached` exist and are used by every platform launcher; no Docker-specific tool built yet
- [x] Windows GUI-app launch — built as direct `.exe` resolution + spawn (`platform/windows/`), deliberately *not* `start`/ShellExecute (both route through `cmd.exe`, the same risk class as Node's CVE-2024-27980 for `.cmd`/`.bat` shims — see that file's own doc comment); replaces the old macOS `open -a`/AppleScript step
- [x] Sequence steps (wait where needed)
- [x] Show per-step status (success/fail)
- [ ] Basic retry button per failed step

### Explicitly NOT in v1
- No teardown of previous workspace
- No conflict/port detection
- No k8s context switching
- No parallel workspace support
- No AI-driven decisions — rules only

## Tier 2 — v2 (after v1 validated)

### State tracking
- [ ] Track what's currently running
- [ ] Track active k8s context
- [ ] Track occupied ports

### Teardown
- [ ] Stop containers on switch (`compose down` / `tilt down`)
- [ ] Close/repurpose terminals on switch
- [ ] Reset k8s context if needed

### Conflict handling
- [ ] Check port availability before start
- [ ] Check current k8s context before switch
- [ ] Switch context only if different
- [ ] Fail with clear message, not silently

### UI
- [ ] Real per-step state (running/stopped/failed/needs attention)
- [ ] Manual override / force-stop option

## Tier 3 — vision (not scoped yet)

- [ ] Read machine specs (RAM/CPU/disk)
- [ ] Warn/block if specs can't support parallel run
- [ ] Dynamic port allocation
- [ ] Isolated docker networks per workspace
- [ ] Separate k8s namespaces/contexts concurrently
- [ ] Track N independent process trees, not one

## Rule while building

- Do not touch Tier 2/3 items until Tier 1 ships
- Do not add steps not on this list mid-build
- If a new idea surfaces, write it under Tier 3, move on
