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
- [x] Keep the Workspace Launcher window on top / refocused during restore — minimal live "Step X of N" IPC signal (`packages/shared/src/restore-progress.ts`) + a reference-counted, self-expiring always-on-top session (`apps/desktop/src/main/ipc/restore-focus.ts`), wired through `handlers.ts`'s restore IPC handler via `BrowserWindow.fromWebContents`. Deliberately minimal — not the fuller Tier 2 "Real per-step state" UI (force-stop, manual override, rich state icons), which stays deferred. Windows/Linux focus behavior is unit-tested but not yet manually verified (still blocked on VM access).

### Config UX — no manual typing (must-have before ship)
- [ ] Replace free-text fields with real pickers across all tool steps: VS Code project path via native folder-browse dialog (+ recent list) instead of typing a path; Spotify playlist via a real account connection + picker instead of pasting a URI; Chrome profile via real on-disk profile enumeration instead of typing a folder name
- [ ] Auto-locate each tool's real installed app path instead of relying on a hardcoded name lookup
- Added to Tier 1 on 2026-09-24 (founder call: "people wont type each shit by themselves... its a must have for users before shipping"). Explicitly scheduled for *after* the current Edit-workspace-modal redesign ships, not blocking it. Still not started — the real tool logos shipped this session (below) are a display-only step toward the redesign, not this item.

### Tool badge assets
- [x] Real per-tool brand logos (VS Code/Spotify/Chrome/Clockify), served from `apps/desktop/src/renderer/public/tool-logos/` — see that folder's `NOTICE.md` for sources/licenses. Rendered via a new `ToolBadge` component (`apps/desktop/src/renderer/src/components/ToolBadge.tsx`) that falls back to the existing generic tinted-icon badge for any step type without a real logo (docker/terminal/slack today).

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
