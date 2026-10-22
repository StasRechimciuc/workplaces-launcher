# Save My Current Workspace — one-click detect-and-build

A global hotkey (plus a tray-menu entry and a Sidebar button) that
detects everything currently running on the user's Mac, matches each
thing to one of this app's existing step types where possible, builds a
draft workspace config from it, and shows a review screen before saving
anything. The "pull-forward from Tier 3" item raised 2026-10-22 mid-build
on the global hotkey feature, explicitly deferred at the time, then
judged through a full `/judge` round (idea approval with real
back-and-forth revision over multiple rounds, a technical plan with an
adversarial review pass) before any code was written.

## What it does

- **One click** — a standalone global hotkey (no per-workspace
  duality, unlike the existing Restore/Switch hotkeys), its tray-menu
  companion ("Save current workspace"), or a plain Sidebar button —
  triggers detection.
- **Detection, not magic**: enumerates currently running foreground
  apps, matches each to a step type via the same product-name
  constants the rest of this app already uses, and falls back to the
  existing generic `app` step for anything with no dedicated plugin —
  no new per-app integration work required ever.
- **A review screen, always** — every detected item is shown,
  pre-checked and togglable, with any best-effort/partial detection
  flagged explicitly (never silent). Nothing is saved until the user
  confirms. Each row's icon is the same `ToolBadge` the rest of the app
  already uses (real logos for VS Code/Chrome/Spotify/Clockify, the
  app's own extracted icon for a generic step, enlarged to 48px on this
  screen specifically after it read too small/plain at the normal
  24px list size).
- **Inline, per-row editing** — a row expands (chevron, click-to-open,
  same interaction as the main "Edit workspace" form) to reveal that
  step type's own real fields component (`step-fields/registry.ts` —
  the SAME components `WorkspaceFormModal.tsx` uses, not a second,
  parallel editor). Correcting a terminal's recovered command, setting
  a VS Code path by hand, or picking a Chrome profile/Spotify playlist
  all work directly on this screen before saving, not only afterward.
- **Reuses the existing save path exactly** — the confirmed draft is
  handed to the same `createWorkspace`/`workspaces:create` flow the
  manual "New workspace" form already uses. No new schema, no new
  validation layer.

## Why this shape

### Scalable by construction, not by promise

The founder's explicit requirement going in: this must not require
writing a dedicated plugin for every app that might show up running.
Resolved by `orchestrator/detection-registry.ts` — a flat,
`Partial<Record<type, DetectionSpec>>` map, additive only, mirroring
`tool-identity.ts`'s existing precedent of staying outside the
`ToolPlugin` interface. Only vscode/chrome/spotify/clockify have a
spec; everything else (Terminal/iTerm2 aside, handled separately) falls
through to a generic `app` step — the same catch-all this codebase
already uses for manually-added steps. A future step type becomes
detectable by adding one name constant and one registry entry, not a
rewrite.

### Deliberately NOT built: a generic SQLite read of VS Code's own state

The original plan called for reading VS Code's `state.vscdb` (its own
undocumented, version-fragile internal SQLite file) to recover open
project folders without needing the companion extension. Dropped
during implementation: this project has zero SQLite dependency today,
and adding a native one (`better-sqlite3` or similar, with Electron
rebuild overhead) purely for a best-effort, undocumented read wasn't
worth it. VS Code project-path recovery now relies **solely** on
extending the existing companion extension's handoff mechanism
(`packages/shared/src/vscode-restore.ts`'s new
`writeCurrentWindowState`/`readCurrentWindowState`/
`listOpenWindowFolders`) — the same proven, already-tested
file-handoff pattern this project already ships for the opposite
direction (pending terminal restores). A VS Code window with no
installed/reporting extension falls back to a generic `app` step with
an explicit caveat, rather than a fragile direct read.

### Chrome: one best-guess step, not one per open profile window

An earlier description of this feature (in conversation, not code)
claimed two simultaneously-open Chrome profile windows would become
two separate `chrome` steps. That's not actually achievable with the
tools available: `lsappinfo` reports Chrome as a single running
process regardless of how many profile windows are open, and Chrome's
own `Local State` file only ever exposes one `profile.last_used`
value. Corrected before shipping: Chrome produces **at most one**
`chrome` step, always flagged as a best guess on the review screen.
VS Code's multi-window support is real and unaffected — it comes from
the companion extension's own per-window heartbeat, a fundamentally
different mechanism.

### No plugin-per-app, ever — confirmed directly with the founder

Mid-build, the founder asked directly whether this meant building a
plugin for every common app. No: a generic `app` step step already
exists and already covers "relaunch this app cold" for anything
without deeper support. A dedicated plugin is only ever worth building
later, driven by real signal (an app repeatedly showing up as a bare
`app` step across many saves) — never a default commitment made here.

## Known limitations — stated plainly, not left implicit

- **Terminal command/cwd recovery is inherently best-effort.** The
  actual original command (`npm run dev`) cannot be reliably recovered
  from outside the terminal without shell integration the user never
  installed — this project settled for "a process is running in this
  directory," confirmed via `ps`'s foreground-process-group marker
  (`stat` containing `+`), never scraped from scrollback/history. An
  idle or already-finished shell is indistinguishable from the
  outside; both save as cwd-only, never a guessed command.
- **iTerm2 detection is unverified on a real machine** — iTerm2 isn't
  installed on the machine this was built on. Its scripting dictionary
  (`tty` as a session property) is real and documented, but
  `terminal-inspection.ts`'s iTerm2 path should be checked directly
  once installed (the founder plans to test Terminal.app first, then
  install iTerm2 to compare).
- **macOS only** — every detection primitive (`lsappinfo`, `osascript`,
  `ps`/`lsof`) is macOS-specific, consistent with this project's
  current platform roadmap.
- **One-time Automation permission prompts** are expected the first
  time this runs (Terminal/iTerm2/possibly System Events scripting) —
  serialized, not fired concurrently, so dialog contention on a
  from-scratch machine doesn't look like several things failing at
  once.

## New files

- `apps/desktop/src/main/platform/macos/app-enumeration.ts` — wraps
  `lsappinfo list`, parsed against a real captured excerpt from this
  project's own dev machine; filters to `type="Foreground"` only
  (confirmed live — this is what separates a real app like VS Code/
  Chrome/Terminal from the dozens of background helpers the same
  listing otherwise returns).
- `apps/desktop/src/main/platform/macos/terminal-inspection.ts` —
  per-window best-effort `{cwd, command}` for Terminal.app and iTerm2,
  via `tty → foreground-process-group pid (ps) → command`, and
  `lsof -a -d cwd -p <pid> -F n` (machine-readable, space-safe —
  confirmed against this machine's real `lsof` output; the review
  caught the original plan's default-columnar-output bug before this
  was written).
- `apps/desktop/src/main/orchestrator/detection-registry.ts` — the
  extensible type↔app-name map described above.
- `apps/desktop/src/main/orchestrator/orchestrator-busy.ts` — a real
  shared "something is running/closing a workspace right now" flag,
  wired into every actual entry point (`restoreWorkspace`,
  `switchWorkspace`, `closeWorkspaceStep`), not just the hotkey path.
  The adversarial review caught that the original plan's "reuse
  existing mid-flight state" referred to state that didn't actually
  exist anywhere in the codebase.
- `apps/desktop/src/main/orchestrator/workspace-detection.ts` — the
  orchestration tying all of the above together into
  `detectCurrentWorkspaceDraft()`.
- `apps/desktop/src/main/orchestrator/app-hotkeys-store.ts` — the
  single, non-per-workspace accelerator store.
- `apps/desktop/src/renderer/src/components/AppHotkeyControl.tsx` —
  the Settings-UI recorder for the app-level hotkey (lives in Settings,
  not Detail.tsx — unlike the per-workspace control, this action has no
  single workspace to be contextual to).
- `apps/desktop/src/renderer/src/components/SaveCurrentWorkspaceModal.tsx`
  — the review screen.
- `packages/shared/src/save-current-workspace-channel.ts` — the
  main→renderer "hotkey fired" IPC channel constant, exported both
  through the barrel and via its own subpath (mirrors
  `restore-progress.ts`'s exact precedent, for the same sandboxed-
  preload reason).

## Modified files

- `packages/shared/src/vscode-restore.ts` — new
  `writeCurrentWindowState`/`readCurrentWindowState`/
  `listOpenWindowFolders`, a heartbeat-based reverse handoff (the
  extension writes, the desktop app reads) keyed by the same
  folder-path hash the existing pending-restore file already uses —
  VS Code can't open one folder in two windows at once, so this key is
  already collision-free with no new id scheme needed. A heartbeat
  (not a one-shot write) specifically so a window the user never
  defocuses doesn't go stale.
- `apps/vscode-extension/src/extension.ts` — writes the heartbeat on
  activation and on a timer; best-effort cleanup on `deactivate()`.
- `apps/desktop/src/main/platform/chrome-profiles.ts` — new
  `getLastUsedChromeProfileFolder()`, reusing the same `Local State`
  read `listChromeProfiles()` already does.
- `apps/desktop/src/main/orchestrator/hotkey-service.ts` — registers
  the one app-level accelerator in the same `syncHotkeys()` pass as
  every per-workspace one (two independent passes would have the
  second silently wipe the first's registrations); a new
  `registerShowMainWindow()` setter lets `main/index.ts` hand this
  module a way to show/focus/create the main window without a circular
  import.
- `apps/desktop/src/main/ipc/handlers.ts` — `setAppHotkey`/
  `clearAppHotkey`/`getAppHotkey`/`getAppHotkeyFailedBinding`,
  `detectCurrentWorkspace`, `markWorkspaceActive`; a **symmetric**
  collision check added to both `setWorkspaceHotkey` and `setAppHotkey`
  — the review caught that Electron's `globalShortcut.register()`
  never reports a same-process double-registration as a failure, so
  this cross-store collision could only ever be caught by an explicit,
  named check, never by `syncHotkeys()`'s own OS-level failure
  detection.
- `apps/desktop/src/main/index.ts` — the tray-menu "Save current
  workspace" entry; registers `showOrCreateMainWindow` with
  `hotkey-service.ts` at startup.
- `apps/desktop/src/preload/index.ts` — the new bridge methods.
- `apps/desktop/src/renderer/src/App.tsx` / `Sidebar.tsx` /
  `SettingsModal.tsx` — wiring for the modal, the manual trigger
  button, and the Settings row.
- `packages/shared/src/types.ts` — `DetectedStepDraft`,
  `UnmatchedRunningApp`, `DetectWorkspaceDraftResult`.

## Caught in a post-build review pass (not left in)

A full review (`/code-review high`) run right after the initial build found 10 real issues, 9 fixed immediately:

- **A real cross-store hotkey collision gap**: `setWorkspaceHotkey`'s and `setAppHotkey`'s "symmetric" collision checks only compared against each other's *stored* values, never against a workspace's *derived* Shift/Switch variant — which `syncHotkeys()` registers live but which is never persisted anywhere `getAllHotkeyBindings()` exposes. A new app hotkey could silently steal an existing workspace's working Switch trigger with zero error shown anywhere. Fixed by also checking `switchAccelerator(...)` in both directions.
- **A stale-response race** in the review screen: it stays mounted for the app's whole session, so `isMountedRef` alone never catches a slower, earlier `detectCurrentWorkspace()` call resolving after a newer one (close, reopen, both in flight). Fixed with a per-open cancellation flag.
- **`isShellCommand()` missed `login`/`su` wrapper processes** — a terminal's foreground-group leader occasionally reports as `login -pf user /bin/zsh` rather than the shell itself, which would have been saved as "the running command." Added to the exclusion set.
- **A per-window detection failure was silently dropped** — distinct from the already-handled "zero windows at all" case, one window out of several failing its own `ps`/`lsof` chain produced no caveat, no issue, nothing — directly against this feature's own "never silent" design. Now surfaces its own issue.
- **A total `lsappinfo` failure was indistinguishable from "nothing is open"** — both collapsed to the same empty list. `listForegroundApps` now returns a `{success, apps}` result so a real failure is always named.
- **A dead-but-unsafe-if-ever-reached branch** in VS Code detection (a defensive `bundlePath` re-check the type system couldn't actually prove unreachable) — tightened with a type-predicate `find()` instead, removing the branch and the risk together.
- **`deriveDefaultName` lost a perfectly good detected name** whenever the folder path had a trailing slash (`.split('/').pop()` returns `''`). Fixed.
- **Terminal, VS Code, and Chrome detection ran sequentially** despite being fully independent I/O — needlessly stretching the "Detecting…" spinner by their sum instead of their max for this interactive, hotkey-triggered action. Now run concurrently.
- **`detection-registry.ts` hand-duplicated the type→name mapping** a third time (`tool-identity.ts`'s switch, `platform/app-detection.ts`'s own map, and this one). Now derives its key set from the same canonical `TOOL_APP_KEYS` list, so a future addition to that list is automatically detectable here too — the name-constant wiring itself still can't be fully unified with `tool-identity.ts`'s separate switch (which also covers the dynamic `app`/`link` types), a known, documented residual gap rather than a silently accepted one.

One finding flagged, not fixed: `AppHotkeyControl.tsx` is near-verbatim duplicated from `WorkspaceHotkeyControl.tsx` (the recording state machine, the timeout helper, the whole idle/recording/saving/error flow). A shared `useHotkeyRecorder` hook would collapse both to just their JSX — left as a recommended follow-up rather than refactored unprompted, since both components work today and have no test harness to catch a refactor mistake.

## Caught in live founder testing (not in the code review pass)

Running the real dev build surfaced two UX issues no static review would — both fixed the same session:

- **The review screen's icons weren't recognizable at all** at first — it shipped with no icon per row. Fixed by reusing `ToolBadge` (the same component the main workspace timeline already uses), at 48px instead of its usual 24px since the smaller size read as "plain and small" at this screen's scale.
- **The Terminal badge (the one real icon-fallback case visible on this screen — every other row has a real brand logo) then looked oversized and flat next to the real logos**, even after a first attempt to fix it by shrinking just the icon glyph. The actual cause: a generic icon badge fills its ENTIRE chip with solid color, while a real logo sits inside a neutral frame with its own built-in padding/transparency — no amount of glyph-only shrinking fixes a background that still floods the whole box. Fixed by restructuring `ToolBadge.tsx`'s generic-icon fallback to match the real-logo structure: the same neutral `bg-bg-elevated` outer frame, with color confined to a smaller (68%) inset shape behind the glyph. This is a shared-component fix, so it also improved the smaller Terminal badges everywhere else in the app (the main workspace timeline, the "New workspace" form), not just this screen.

## Related, same session: quick per-step removal

While testing this screen, a quick way to drop a single step from an already-saved workspace (without opening the full "Edit workspace" modal) was added to `Detail.tsx`'s restore timeline — a hover-revealed trash icon per `TimelineStep` row, same no-confirmation precedent as `WorkspaceFormModal`'s existing `removeTool`/`EditableStringList` remove buttons, persisting immediately via the same `updateWorkspace` call the inline quick-edit Save button already uses. Not specific to "Save current workspace," but shipped alongside it — see `docs/build-shell.md`'s Tier 1 Config UX section.

## Tests

Unit tests for every new main-process module (mocked `runCommand`/
`osascript`/`fs`, several assertions built directly from real captured
output from this project's own dev machine — `lsappinfo list`,
`lsof -F n` — not guessed formats), `workspace-detection.test.ts`
covering the full matching/fallback/unmatched/issue-surfacing matrix,
`orchestrator-busy.test.ts`'s overlapping-call reference-count case,
`hotkey-service.test.ts`'s new app-level registration/collision/trigger
coverage, `handlers.test.ts` additions for every new function and IPC
channel. No new renderer component tests — matches this repo's
established precedent.

## Verification

`npm run lint && npm run typecheck && npm run test && npm run build` —
all green (829 tests passing) after the main implementation and again
after every slice/fix that followed (the review pass, the two icon
fixes, the trash-icon addition), not just at the end, given this
round's size.

This round was actually run through a real build, not just unit tests
— the founder tested the live dev app directly (Terminal.app's own
detection, the review screen's icons/editing), which is how both the
icon-rendering issue and the "where's the inline edit" gap were caught
at all; neither would show up in any automated test. iTerm2's own
detection path in `terminal-inspection.ts` is still the one piece not
yet verified against a real running instance — the founder's plan is
to install it and compare directly.
