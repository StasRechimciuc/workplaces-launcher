# Workspace Launcher — Build Shell

## Tier 1 — v1 (build now)

### Core
- [x] Define workspace config format (JSON) — `WorkspaceConfigSchema` (`packages/shared/src/config-schema.ts`)
- [x] Config holds ordered list of steps
- [x] Each step: tool type + params
- [x] App reads config, runs steps in order — `orchestrator.ts`, platform-agnostic; unit-tested on macOS/Windows both, real end-to-end manual run on Windows paused along with the rest of Windows work (see claude.md's Platform roadmap, updated 2026-10-21 — macOS primary until the founder's daily machine switches to Windows)
- [x] Simple UI: workspace list + detail — real, not mocked (persisted configs + create/edit/delete)

### Step types to support
- [x] VS Code — open folder path (plus optional terminal/command restore via the companion extension, below)
- [x] Terminal — open pane(s), run command(s) as its own standalone step type (distinct from the VS Code step's narrower terminal restore, which is scoped to that step only). Went through a full `/judge` round; see `WC__project-status.md`'s "Terminal step type" entry for the shipped design.
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
- [x] Basic retry button per failed step — `orchestrator.ts`'s `retryStep` + `ipc/handlers.ts`'s `retryWorkspaceStep`, reachable post-restore only, replaces the failed row in place; see `WCs/WC__retry-per-step.md`
- [x] Keep the Workspace Launcher window on top / refocused during restore — minimal live "Step X of N" IPC signal (`packages/shared/src/restore-progress.ts`) + a reference-counted, self-expiring always-on-top session (`apps/desktop/src/main/ipc/restore-focus.ts`), wired through `handlers.ts`'s restore IPC handler via `BrowserWindow.fromWebContents`. Deliberately minimal — not the fuller Tier 2 "Real per-step state" UI (force-stop, manual override, rich state icons), which stays deferred. Windows/Linux focus behavior is unit-tested but not yet manually verified (Windows work paused — see claude.md's Platform roadmap).

### Config UX — no manual typing (must-have before ship)
- [x] Replace free-text fields with real pickers across all tool steps: VS Code project path via native folder-browse dialog (+ recent list) instead of typing a path; Spotify playlist via a real account connection + picker instead of pasting a URI; Chrome profile via real on-disk profile enumeration instead of typing a folder name — see `WC__project-status.md`'s "Config UX pickers" entry
- [x] Auto-locate each tool's real installed app path instead of relying on a hardcoded name lookup — went through a full `/judge` round (the founder's own hard constraint: "it must work for any user therefore no hardcodings," ruling out even a single hardcoded bundle ID per tool). See `WC__project-status.md`'s "Real app-location detection" entry for the shipped design.
- Added to Tier 1 on 2026-09-24 (founder call: "people wont type each shit by themselves... its a must have for users before shipping").
- [x] Quick-remove a single step directly from the Detail view's restore timeline (a hover-revealed trash icon per step, TimelineStep.tsx) — immediate, no confirmation dialog, matching this app's existing precedent for removing one item within an editing context (WorkspaceFormModal's removeTool, EditableStringList's own remove row) rather than the heavier, confirmed "Delete workspace" flow. Persists via the same `updateWorkspace` call the inline quick-edit Save button already uses. Added 2026-10-22, direct founder ask while testing the "Save current workspace" review screen.

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
- [ ] Workspace migration between devices and between OSes (e.g. Mac -> Windows once the founder switches). Raised 2026-10-21 — explicitly "not yet, its big," not scoped. Likely touches: config portability/sync (today's configs live in per-machine `electron-store`), cross-platform path translation (`~/projects/x` on macOS vs `C:\Users\...` on Windows), and reconciling which tool plugins exist on the source vs. target OS.
- [x] Global hotkey to restore/switch a workspace from anywhere, even when the app isn't focused. Raised 2026-10-21 — picked as the first of three "widen appeal without adding more app integrations" ideas; founder explicitly flagged real open questions before building: colliding with this app's own existing shortcuts, colliding with OTHER apps'/the OS's global shortcuts, and what a single hotkey actually triggers (Restore vs Switch aren't the same action, and there's more than one workspace). Pulled forward, went through a full `/judge` round (idea approval + a technical plan with an adversarial review pass), and shipped 2026-10-22 — per-workspace hotkey (base combo = Restore, +Shift = Switch), plus the tray/background-persistence and launch-at-login work it needed to actually hold true "from anywhere." See `WCs/WC__global-hotkeys.md` for the full design and known limitations (placeholder tray icon, a pre-existing VS Code terminal-restore handoff race made newly reachable).
- [x] Generalize the "app" step type to files/URLs, not just launching an app cold (e.g. a specific document, folder, or Figma/Notion link). Raised 2026-10-21 — the second of the three "wider range of users" ideas. Pulled forward, went through a full `/judge` round (idea approval with real revision, a technical plan with an adversarial review pass), and shipped 2026-10-22 as a new "File or Link" step type (not an extension of "app" — see `WCs/WC__file-or-link.md` for why), with one auto-detecting field plus an optional "open with a specific app" override. Links restricted to http/https after discovering the original custom-scheme (`notion://`/`figma://`) motivation didn't hold up to how those apps' own "copy link" actually works; the "open with a specific app" override covers the real version of that use case instead. **NOT considered stable** — the "Open with" override has a real, unresolved gap (an incompatible app+file pairing reports success with no way to detect or prevent it) found only in a post-ship product conversation, not during the judge/review passes — needs rethinking before trusting it's complete. See `WCs/WC__file-or-link.md` for the full design and known limitations.
- [ ] Starter workspace templates/presets (content layer, not code) so a first-time non-dev user sees something relevant immediately instead of a blank dev-flavored UI. Raised 2026-10-21 — third of the three "wider range of users" ideas. Explicitly deferred 2026-10-22 — "templates should be a bigger feature for when we have more apps to choose from like Word, Microsoft PPT or Canva, Adobe set... rn no real use": with today's tool set (VS Code/Chrome/Spotify/Clockify/Terminal/App/File-or-Link), there isn't enough non-dev-relevant variety to build templates actually worth having. Blocked on more app integrations landing first, not on scoping work — do not pick this up before that.
- [ ] Parallel vs. serial step restore, mixed per-workspace — today every step always runs strictly one at a time, in order (`orchestrator.ts`'s `runWorkspace`). Idea, raised 2026-10-22: steps with no real dependency on each other should be able to restore in parallel for speed, while a step that genuinely needs another one ready/idle first (e.g. "don't open VS Code until Docker's up") can still specify that ordering explicitly — full flexibility between fire-and-forget speed and real sequencing, not an all-or-nothing switch, and not a choice the user has to make for the whole workspace at once. Not yet scoped — real open questions before this goes through `/judge`: how "ready" is actually detected per step type (today's `isAppRunning` liveness check — see `WCs/WC__workspace-activity.md` — is coarse, app-level only, "is it running at all," not "is it actually ready for whatever depends on it"); how a user expresses which steps can run in parallel vs. which must wait, and for what condition, with no manual typing (this app's standing config-UX rule); and how today's strictly-sequential per-step progress push (`restore-progress.ts`) and `StepResult[]` reporting generalize once steps aren't a simple 1-by-1 list anymore.
- [x] One-click "save my current workspace" — a hotkey (plus a tray-menu entry and a Sidebar button) that auto-detects what's currently open (apps, terminals and what they're running, Chrome's last-used profile, VS Code's open project folders via its companion extension) and builds a new workspace draft from it, with a review screen (every item pre-checked and togglable, best-effort detections flagged explicitly) before anything saves. Raised 2026-10-22, mid-build on the global hotkey feature above — explicitly deferred at the time, then pulled forward and went through a full `/judge` round (idea approval with real iterative revision — the scalability requirement, dropping a custom-URL-scheme-style over-scoped file/tab-state idea for arbitrary office apps, resolving to "no plugin per app, ever" — a technical plan with an adversarial review pass that caught 7 real issues before any code existed). Shipped 2026-10-22. Architected to be additive for future step types (one registry entry, not a rewrite) without committing to building any of them now. See `WCs/WC__save-current-workspace.md` for the full design, the scope corrections made during implementation (dropped a planned SQLite read of VS Code's own state in favor of the existing companion-extension pattern; corrected an earlier claim that Chrome would support multiple simultaneous profile-window detection — it only supports one best-guess profile), and known limitations (terminal command recovery is inherently best-effort; iTerm2's detection path is unverified on a real instance). The review screen supports inline per-row editing via the same fields components the main "Edit workspace" form uses, added after a post-build review pass (also now a standing `/judge` step — see Stage 4 in `.claude/skills/judge/SKILL.md`) and direct founder feedback on an early build.

- [ ] Polish the tray menu to show each action's configured shortcut next to its label, not just plain text — reference pattern: Wispr Flow's own menu-bar dropdown, which shows an accelerator (e.g. `⌘,` for Settings, `⇧⌘O` for Getting Started) beside every item. Today `apps/desktop/src/main/index.ts`'s `buildTrayMenu()` items (`Open Workspace Launcher`, `Save current workspace`, `Quit Workspace Launcher`) have no `accelerator` set, even though `Save current workspace` already has a real, user-configurable global hotkey (`WCs/WC__save-current-workspace.md`) that could be surfaced right there. Raised 2026-10-23, mid-scoping the heavy-dev-environment orchestration testbed — explicitly deferred, not scoped.

## Rule while building

- Do not touch Tier 2/3 items until Tier 1 ships
- Do not add steps not on this list mid-build
- If a new idea surfaces, write it under Tier 3, move on
