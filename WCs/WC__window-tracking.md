# Per-resource tracking: windows, processes, focus (researched, not built)

Everything a workspace opens becomes a tracked **resource** with an
owner, so Restore/Close/Switch/Retry/hotkeys act on exactly the right
windows and processes: reuse what's already there, close only what's
no longer needed, and never open a second copy of something that
exists. Idea decided 2026-10-26, scope expanded and every open
question researched and spike-tested on a real Mac 2026-10-28. One
question is left for the Stage 2 spike (focus from the background on
a hotkey, see "Still open"). Nothing is built.

## The motivating bug

Reported directly: "Retry doesn't close old windows — I had two
terminals that failed and it doesn't close them, it just opens two new
ones." Terminal and Docker's Tilt engine (both via `openTerminal`)
duplicate on every call, with no window tracking at all. Chrome also
duplicates every call, deliberately — `-n` is required for
`--profile-directory`/URL args to reach an already-running Chrome
(see macos/launcher.ts's own comment). VS Code does NOT duplicate, but
only incidentally: that's VS Code's own per-folder idempotency, not
anything this app tracks.

## Scope (expanded 2026-10-28)

The original scope was "close my own windows on Retry, plus a focus
button." The founder widened it to the real requirement: **everything
is tracked**, precisely enough to really close, switch and reuse
projects. Concretely:

- Two VS Code projects open at once, each with its own terminals,
  tools and processes — closing project B touches nothing of A's.
- Restoring or hotkey-opening a workspace whose pieces already exist
  focuses / brings them up instead of opening duplicates — e.g. never
  a second `caffeinate` terminal when one is already running.
- Hotkeys use the same machinery: open what's missing, focus what
  exists.

This **replaces** WC__workspace-activity.md's "One global
running-fact, not a per-workspace ownership ledger" decision. That was
right for app-level tracking (Spotify is Spotify), but it cannot
express "this VS Code window belongs to A, that one to B" — the
ledger is exactly what per-window ownership needs.

## The model

Every step creates zero or more **resources**. Each has:

| Property     | Meaning                              | Examples                                                                          |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| **Identity** | What makes two of them "the same"    | VS Code + folder; terminal + directory + command; Compose + project name          |
| **Handle**   | How to find this exact one again     | Window id + held AX reference; process id + tty; VS Code window via the extension |
| **Owners**   | Which workspaces currently claim it  | `{A}`, or `{A, B}` when shared                                                    |
| **Liveness** | Still there, and still doing its job | Window exists; the command is still running in it                                 |

The ledger (resource → identity, handle, owners) is persisted, like
`workspace-activity-store.ts`, and re-validated on launch.

Rules every action follows:

- **Open** (Restore, hotkey): a live resource with the same identity
  exists → reuse it, add this workspace to its owners, focus it.
  Otherwise create it and record its handle.
- **Close workspace X**: remove X from each resource's owners; a
  resource is closed only when no owners remain. Anything shared with
  another active workspace stays.
- **Switch to Y**: close everything Y doesn't need, open what Y is
  missing, focus Y.
- **Retry a step**: close that step's own resource, then recreate it —
  the motivating bug's fix.
- **Hotkey**: same as Open; when everything already exists it only
  focuses.

## Decisions (founder, 2026-10-28)

1. **Resources the user opened by hand** (e.g. VS Code already open on
   the workspace's folder): reuse and focus them, **never close them**
   on Close/Switch. Only resources this app created are ever closed.
2. **Window alive, command dead** (terminal open, `npm run dev`
   crashed): re-run the command in the same window.
3. **Hotkey on a fully open workspace**: bring all its windows
   forward, one "primary" window on top (VS Code by default).
4. **Drift** (a tracked terminal `cd`'d elsewhere, a tracked VS Code
   window switched to another folder): the resource is dropped — it's
   no longer the workspace's. The next restore opens a fresh one. Not
   the same as decision 2: there the identity still matches.
5. **Chrome steps** open with `--new-window`, so each Chrome step is
   one dedicated window holding its URLs — tracked, reused, focused and
   closed like everything else. Without it, a URL opens as a tab in
   whatever window that profile already has (finding H), and a tab
   can't be closed or focused cleanly without a Chrome extension.
6. **The desktop jump after an app restart** is accepted: a window on
   another desktop (Space) can only be re-acquired by activating its
   app, which visibly jumps there (finding S2). The app already
   persists in the tray, so restarts are rare; after one, handles are
   re-acquired lazily, only when an action needs them.

## Cases the build must handle

1. Already open before this app touched it (decision 1).
2. The user closed it by hand → handle dead → drop the resource,
   reopen on the next restore.
3. Window alive, command dead (decision 2).
4. Drift (decision 4).
5. App restart / reboot → persisted ledger, re-validated on launch
   (dead entries dropped, live ones re-acquired lazily — decision 6).
6. Shared resources (Spotify, `caffeinate`, one Compose stack used by
   two workspaces) → owner sets.
7. Same app, different targets (two VS Code projects, two Chrome
   profiles, two terminals in one directory running different
   commands) → identity includes the target.
8. Windowless resources (Compose, background processes) → close means
   stop, not close a window.
9. Permission denied or revoked later → a reduced mode (see below),
   never a silent failure.

## Permissions: Accessibility only, never Automation

The founder's call: ask once, up front, and use it for everything —
not one prompt per app. That rules out AppleScript/Apple Events for
window control, because **Automation is granted per target app** and
can't be granted in bulk. **Accessibility** is one switch that covers
every app's windows. Findings A and B confirm nothing else this design
needs triggers an Automation prompt.

This is still a deliberate reversal of `openTerminal`'s
no-permission choice (see its own comments). It is justified by what
this feature does (track and selectively close specific windows
across workspaces is impossible on macOS without it) and by the
longer-term platform migration, which needs real ownership tracking
anyway.

**Onboarding** (first launch, before any workspace runs):

- An in-app screen explains plainly why the permission is needed,
  linking to the privacy policy page (still to be written — tracked
  here so it isn't forgotten).
- **Grant access** opens System Settings straight at Privacy →
  Accessibility.
- macOS **adds the app to that list by itself, switched off, the
  moment it first calls an Accessibility API** (seen during the
  spike: WTHost and WTHelper both appeared unprompted). So the normal
  path is just flipping the switch. Drag-to-add is the fallback when
  the app isn't listed: a small floating panel with the app's icon,
  docked to the Settings window — the pattern open-source
  PermissionFlow / TrustMe / Permiso implement, and Wispr Flow /
  FluidVoice ship. Drag only works from a real installed `.app`.
- The app polls for the grant and moves on with a confirmation.
- Revoked later → affected actions show "needs permission" with the
  same flow. Detection must not trust `AXIsProcessTrusted` alone in
  the long-running app: after the app is _removed_ from the list (vs.
  switched off) it can keep returning a stale `true`. Check from a
  freshly spawned helper process, which reads it reliably.
- **Dev caveat**: under `npm run dev` the grant attaches to the
  Electron binary / the terminal, not to Workspace Launcher. The real
  flow is only testable in a packaged build.

**Screen Recording is not needed**: window titles come through
Accessibility; the system window list only hides titles without it
(finding G).

## Native helper

Electron can't call the Accessibility API or AppKit directly. Wispr
Flow (also Electron) uses a Swift helper for this — the same shape
here. **The helper must run as a child process of the main app**, not
as its own app: a child inherits the main app's Accessibility grant,
a separately launched helper app does not and would need (and
clutter the Settings list with) a second grant (finding C). Swift
helper vs. Node native addon vs. `koffi` FFI is a Stage 2 choice; the
child-process constraint holds for all three (an addon runs in-process
anyway).

## Per-resource mechanics

| Resource                               | Handle                                                                                                                                                     | Close                                                                                              | Focus                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| Terminal window (Terminal step, Tilt)  | Window id caught by diffing the window list around `open -a Terminal`; held AX reference; tty + shell pid written by `openTerminal`'s own generated script | Kill the process tree first (by tty/pid), **then** press the window's close button via AX (D1, D2) | AX raise + app activation |
| VS Code project window + its terminals | Companion extension: window's folder, terminals with their process ids                                                                                     | Extension disposes terminals / runs `workbench.action.closeWindow` (F)                             | AX raise + activation     |
| Chrome window                          | Window id caught by diffing around `open -n … --new-window`, intersected with AX-visible windows (H)                                                       | AX close button                                                                                    | AX raise + activation     |
| Generic app                            | App-level (no per-window identity); per-window via AX title when needed                                                                                    | Native quit (`NSRunningApplication.terminate`) (A)                                                 | Activation                |
| Compose / background process           | Compose project name / process id                                                                                                                          | `compose down` / signal                                                                            | n/a                       |

"Closed" is decided by **the held AX reference no longer resolving**,
not by either window list alone: Chrome leaves a closed window in the
system list for seconds (H), and a Terminal window with a dialog
attached is still listed while blocked (D1).

## Findings (research + spike on macOS 26.6.2, 2026-10-28)

Spike code: `spikes/window-tracking/` (`probe.swift` + `run.sh`),
throwaway, removed before the `testing-pass` squash.

| #   | Question                                                                              | Result                                                                                                                                                                             | Consequence                                                               |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A   | Does the native quit (`NSRunningApplication.terminate`) trigger an Automation prompt? | No — from Terminal and from a test app with its own identity, with and without Accessibility; zero TCC log entries; the app really quit                                            | Whole-app quit uses it; AppleScript `quit` is retired                     |
| B   | Does today's `application "X" is running` prompt?                                     | No                                                                                                                                                                                 | Existing liveness check is safe                                           |
| C   | Does a helper share the app's Accessibility grant?                                    | Child process: yes. Separately launched helper app: no                                                                                                                             | Helper runs as a child (see "Native helper")                              |
| D1  | Close a Terminal window while its command runs?                                       | A "terminate running processes?" dialog appears; the window stays open; the dialog is detectable (`sheet_shown`)                                                                   | Never close a busy terminal                                               |
| D2  | Kill the processes first, then close?                                                 | Closes cleanly, no dialog. Terminal does **not** auto-close when the shell exits                                                                                                   | Close = kill tree, then close window                                      |
| E   | `open -a Terminal x.command`: window or tab?                                          | New window (with default prefs)                                                                                                                                                    | Users with "open in tabs" get tabs — handled by T's mechanics             |
| F   | Can the extension close its own VS Code window?                                       | Yes                                                                                                                                                                                | VS Code close goes through the extension                                  |
| G   | Stable window ids?                                                                    | Yes, via private `_AXUIElementGetWindow`; ids match the system window list. Titles need Screen Recording there; owner names don't (on 26.6)                                        | Window id is the persisted handle; titles come from AX                    |
| S1  | Window moved to another desktop — reachable via a reference held from before?         | Yes: focus jumped to its desktop and showed it; closing from another desktop worked                                                                                                | Hold AX references from creation                                          |
| S2  | Window on another desktop, looked up fresh (as after a restart)?                      | Invisible to AX until its app is activated; activation jumped desktops and made it reachable                                                                                       | Decision 6                                                                |
| T   | Terminal tabs?                                                                        | Each tab is its own window id; only the active tab is AX-visible, background tabs are off-screen in the system list                                                                | Acting on a background tab = select it through the window's tab bar first |
| H   | Chrome `open -n` with a profile                                                       | URL + Chrome running → a **tab** in an existing window. Profile only → a new window, caught correctly once helper windows are filtered out (Chrome creates several invisible ones) | Decision 5; filter new ids by AX visibility                               |

Other research findings that shaped the design:

- Accessibility only sees windows on the current desktop; references
  obtained while visible keep working after the window moves.
- Since macOS 14, app activation is a request the system may refuse
  ("cooperative activation"), and raising a minimized window does
  nothing — focus = un-minimize, raise, activate, and handle refusal.
  (Activation from a CLI process was not refused in the spike; the
  real case is the background app on a hotkey — see "Still open".)
- `_AXUIElementGetWindow` is private and undocumented, used by window
  managers (yabai, AltTab-style tools); if a future macOS breaks it,
  fall back to matching by title + size + position.
- Window titles as markers are unreliable (oh-my-zsh and many CLIs
  rewrite them), so terminals are identified by window-list diff +
  tty, never by title.

## Still open → Stage 2 spike

- **Focus from the background on a hotkey**: when a global hotkey
  fires, this app isn't active, and cooperative activation may refuse
  to bring another app forward. Needs the real app.
- **Re-check A and C in the packaged Electron build** with real
  Developer ID signing — the spike used an ad-hoc signed Swift test
  app. Same macOS mechanism, so no change is expected.
- Behavior with "When switching to an application, switch to a Space
  with open windows" turned **off** (spike ran with it on).
- iTerm2 (only Terminal.app was tested).

## Explicitly out of scope

**True interactive handling** — relaying a blocked CLI prompt (e.g.
Claude Code's "trust this folder?") into this app's own UI. You can't
safely or generically parse arbitrary CLI prompts: a password prompt,
a destructive confirmation and a harmless question are
indistinguishable from raw output, and guessing wrong has real
consequences. Doing it for real means a plugin per interactive tool —
open-ended, security-sensitive, judged separately if ever. The
always-available "focus this step's window" action covers the need:
the user decides whether a window needs them; the app makes it one
click away.

## Stage 2 technical plan (2026-10-28, stress-tested, approved)

Written from a full codebase survey, then attacked by an adversarial
review against the real code before approval; the review's fixes are
folded in below.

### Codebase facts that shape it

- Steps have no stable ids — only their array index.
- `retryStep` re-runs `runStep` with no teardown (the motivating bug).
- `getMacAppName` is undefined for terminal and docker, so those are
  invisible to Close and liveness today.
- The desktop app can't reach a running VS Code window (the extension
  only reads the handoff file on activation/focus/manual command).
- `openTerminal` returns no handle; its script deletes itself and its
  sentinel.
- "Save current workspace" uses AppleScript `tell application
"Terminal"/"iTerm2"` (Automation) in `terminal-inspection.ts`.
- `withOrchestratorBusy` is a refcount, not a lock; Retry isn't wrapped.

### 1. Native helper (`wl-helper`, Swift)

- Persistent child process of Electron main, JSON-lines RPC over
  stdin/stdout. Persistent because held AX references live only in the
  process that created them (S1); a child because it inherits the app's
  grant (C). Why not Node: no direct API access — a native addon needs
  rebuilding per Electron version and crashes the app with it; `koffi`
  FFI is clumsy for AX and the private window-id call. Same shape as
  Wispr Flow (Electron + Swift helper).
- Methods: list window ids, capture new window, window state
  (alive / gone / blocked-by-sheet), close, focus (unminimize, raise,
  `NSRunningApplication.activate`, `open -b` only if activation is
  refused), is-running, quit (`terminate`, finding A).
- Hardening: runs its own run loop (no stale app state), AX messaging
  timeout 1s, per-request client timeouts, exits on stdin EOF,
  restarted with backoff on crash.
- Permission check: separate one-shot `wl-helper trust` (a long-running
  process can report a stale grant).
- Build: `swiftc` with explicit `arm64-apple-macos11` /
  `x86_64-apple-macos11` targets + `lipo`; ships in `Contents/Helpers`
  (the layout C tested); `package:mac` fails if it's missing; missing at
  runtime → reduced mode with an explicit error.

### 2. Permission + onboarding

- First-launch modal: why, "Open Accessibility settings", polls every
  second, moves on when granted. Privacy-policy link hidden until that
  page exists (separate task).
- "Continue without" → reduced mode (today's app-level behavior) +
  banner + Settings row. New `ER-PERM-01`.
- One AX call at startup so macOS auto-lists the app.
- Drag-to-add floating panel: later phase (fallback only).

### 3. Ledger

- New versioned store `resource-ledger`: `{id, kind, identityKey,
owners[], createdByApp, handle, state}`. Migrations, never wipes (a
  wipe orphans every window we opened).
- The ledger is the single source of truth for "active" (retires the
  intent flag). Invariant: an inactive workspace owns nothing — Switch
  transfers shared resources, delete purges owners, revalidation drops
  unknown owner ids.
- Stable step ids: workspace config schema v2 gives every step a uuid
  (auto-migrated). End-of-run reconcile releases (and, if ours and
  ownerless, closes) resources matching none of the workspace's current
  steps — edits don't orphan.
- Identity keys: JSON-serialized, include the bundle id (VS Code vs
  Cursor, Chrome vs Beta), lexical path (normalized, not realpath'd),
  occurrence index for identical entries; Tilt step and a Terminal step
  running `tilt up` in the same dir share a key.

### 4. Safety guards

- Ledger stores `kern.bootsessionuuid`; on mismatch every handle is
  dropped (window ids and pids reset/reuse across reboot/logout).
- A process is signalled only if pid + start time + tty all match.
  Kill = descendants of the recorded shell, never "everything on a tty"
  (ttys are recycled).
- Window handles store owner pid + bundle id.
- Write-ahead "opening" record before `open`, reconciled at startup —
  crash, helper restart or a timed-out-then-finished step can't leave an
  untracked window. Failed/timed-out steps still record their windows
  (Retry needs exactly those).

### 5. Concurrency

Per-workspace lock (Restore/Close/Switch/Retry serialized per
workspace), per-identity lock (lookup → check → open → record),
per-app capture lock (before-snapshot → capture). Retry busy-wrapped.

### 6. Operations

- Open: live instance exists → reuse, add owner, `createdByApp=false` if
  it existed before this app touched it (decision 1); else open + record
  as ours.
- Close X: drop X as owner; close only ownerless + ours. Per-resource
  results with reasons: `still-used`, `not-ours`, `user-took-over`,
  `modified`, `kept-running`, `failed`, `needs-permission`.
- Switch to Y: transfer what Y also needs, close the rest.
- Retry: close the step's own resources, reopen.
- App-quit blocked while any owned resource of that app is in use
  (also fixes today's latent bug: a link step pointing at Chrome quits
  Chrome).

### 7. Per kind

- **Terminal**: generated script's first line sets a nonce title
  (safe: non-interactive shell; oh-my-zsh only rewrites after
  `exec $SHELL`); writes tty + pid + start time; captured by window diff
  matched on the nonce. **Decision 2 kept**: after the commands finish,
  the script records the exit code and waits in a loop — a re-run
  request from the app re-runs the commands in the same window, any
  keypress drops to the normal shell. Once the user has used the window,
  it's `user-took-over`: never auto-closed. Exit 0 or zero commands =
  alive. Close: SIGHUP (what a window close sends), SIGKILL leftovers
  after 1.5s, then close the window; a dialog anyway → report, never
  auto-confirm.
- **Tilt**: `stopOnClose` on → SIGINT `tilt up`, wait, `tilt down`,
  close the window. Off → window stays, `kept-running`.
- **Compose**: identity = the compose project per `docker compose ls`;
  a stack already running counts as not ours.
- **VS Code**: heartbeat gets a per-window instance id; new
  desktop→extension command channel (directory watch + 1–2s poll, ack
  file, 10s TTL, stale commands ignored on activation, multi-root
  windows excluded, refuses to close with unsaved files). Focus never
  re-runs the step (today it re-stages terminals → duplicates). No
  extension → fall back to quitting the whole app, only if every VS
  Code window is ours.
- **Chrome**: `--new-window` + all URLs in one `open` call; captured
  only with exactly one candidate (else recorded handle-less, reason
  shown); helper windows filtered by layer/size; user-added tabs →
  `modified`, left open.
- **Apps** (generic, Spotify, Clockify, link-with-app): app resources,
  tracked by pid + launch time; native quit; keeps today's
  quit-on-Close.
- **Automation removed entirely**: AppleScript `quit` goes; detection
  finds terminals via `ps` (iTerm2 via `iTermServer`) — also fixes
  today's bug where `tee` is reported as the command.

### 8. Behavior changes and upgrade

- Workspaces active at upgrade time own nothing → their first Close
  runs today's app-level close one last time.
- "Save current workspace": detected things owned by the new workspace
  but `not-ours`.
- Close no longer quits VS Code (with the extension); Chrome-step
  windows are now closed (Chrome itself never quit).
- Hotkey restore and Shift-switch end with a focus pass (primary +
  current-desktop windows, VS Code last); the hotkey path stops pinning
  the launcher. Button restore keeps the pin; all-reused shows "Already
  open — Focus".

### 9. Tests

Helper client against a real spawned fake child (scripted JSON);
ledger migrations, boot guard, owner purge, upgrade path; orchestrator
reuse/create, refcounts, close/switch matrices, shared-resource
concurrency, failed/timed-out opens recording handles, reconcile after
edit, app-quit blocked by a same-app resource, Tilt ordering; exact
launcher script + Chrome argv; extension command channel as pure shared
functions. Swift: manual macOS check script (spike-shaped); macOS CI
building the helper — later, flagged.

### 10. Phases (each verified on the Mac before the next)

1. Helper + client + build + permission check + onboarding (no
   behavior change).
2. Stable step ids, ledger, plugin interface, operations, locks, safety
   guards; app / Compose / VS Code kinds + extension channel; upgrade.
3. Terminal + Tilt windows, re-run loop, Automation removed from
   detection.
4. Chrome dedicated windows.
5. Focus button + hotkey focus pass, after a real-app spike on
   background focus (also checks `--new-window` with Chrome running);
   drag-to-add fallback.

Known limitations: background Terminal tabs can't be closed, only their
processes stopped (T); no Windows/Linux; the VS Code extension still
isn't bundled/installed by the app.

## Phase 2, slice 4 technical plan: orchestrator on the ledger (2026-10-30)

Written from a read of `orchestrator.ts`, `ipc/handlers.ts`,
`hotkey-service.ts`, `workspace-detection.ts` and `Detail.tsx`'s
close-result display.

**Tracked vs untracked steps.** A step is _tracked_ when its tool
declares resources and every spec resolves (today: Spotify, Clockify,
App, File/Link-with-app, all with a saved `.app` path). Every other
step — VS Code, Chrome, Terminal, Docker, steps saved without a path
— stays _untracked_ and keeps today's app-level logic until its own
kind lands. Both live side by side in one Restore/Close/Switch.

**Coexistence rule (no cross-quitting).** An app kind's spec label is
the same app name `getMacAppName` returns, so the two worlds can see
each other: the legacy path never quits an app that has a ledger
resource with owners; the ledger never closes an app resource whose
name an active workspace's untracked step still uses
(`still-used`).

**"Active".** Owns a ledger resource, OR (untracked steps only)
today's intent + liveness. The intent flag stays for untracked steps
and is retired in the upgrade slice once every kind is tracked.
`listWorkspaces` revalidates owned resources (`check`): `gone` is
removed, `unknown` is kept.

**Startup.** In `whenReady`, before IPC registration: read
`kern.bootsessionuuid`, load the ledger, register the app kind,
reconcile `opening` records (new optional kind method
`reconcileOpening(identity, since)` — app kind: an instance whose
process started after the record was written is ours, else the record
is dropped), drop owners of workspaces that no longer exist. A ledger
that fails to load → every step runs untracked, with the error logged.

**Restore, per tracked step** (under its identity locks):

1. Write-ahead: for each spec without a live resource, add an
   `opening` record owned by (workspace, step); snapshot.
2. All specs live and the kind isn't idempotent → skip the run, add
   ownership. Otherwise run the step (unchanged `runStep`).
3. Capture each opening spec — even when the step failed or timed out
   (Retry needs exactly those): found → `open` + handle, `createdByApp
= !preexisting`; not found → record removed, reason logged.
4. A spec already live → add the owner; a pre-existing user-opened
   instance (`findLive`) is recorded `createdByApp: false`.
   End of run: release (and close if ours and ownerless) resources owned
   by this workspace whose step id is no longer in its config — an edit
   never orphans anything.

**Close X.** Release X's claims; for each resource left ownerless:
not ours → `not-ours`, still used by an untracked step elsewhere →
`still-used`, else the kind's `close` (`closed` / `kept-running` /
`needs-permission` / `failed`); closed or already gone → removed from
the ledger; anything that couldn't close stays (ownerless, so it no
longer makes X active). Untracked steps: today's logic. Upgrade case:
a tracked step of an intent-active workspace with no ledger entry
goes through today's app-level close one last time.

**Switch to Y.** Y's specs → identity keys. Release every other
workspace's claims; close ownerless resources except those Y needs
(those are reused, so they transfer to Y); untracked: today's logic.
Then Restore Y.

**Retry a step.** Same lock + busy wrapper as Restore (today it has
neither). Close the step's own resources of non-idempotent kinds,
then run it as in Restore. Apps are idempotent, so retrying an app
step never quits the app — the terminal fix arrives with its kind.

**Delete.** Releases the workspace's claims; never closes anything.
**Save current workspace (`markWorkspaceActive`).** For tracked
steps, `findLive` each spec and record it owned, `createdByApp: false`.

**Locks** (`lib/keyed-lock.ts`, a promise-chain mutex per key): one
per workspace around Restore / Close / Switch (the target) / Retry,
then the step's identity keys in sorted order — that covers both the
per-identity and per-app (an app's identity is its bundle id) locks,
and a fixed order rules out deadlock. Switch releases other
workspaces' claims under identity locks only, never their workspace
locks. `withOrchestratorBusy` and the hotkey `inFlight` set stay.

**Results.** `LeftOpenEntry.reason` gains `not-ours`, `kept-running`,
`needs-permission` (plus the plan's `user-took-over` / `modified`,
used by the terminal and Chrome kinds later). `Detail.tsx` gets a
message per reason.

**Tests.** Orchestrator: reuse vs create, preexisting = not ours,
failed step still captured, skip-when-live for a non-idempotent fake
kind, reconcile after edit, close matrix (ours / not-ours /
still-used by ledger owner / still-used by untracked step /
kept-running / failed), switch transfer, retry closing only
non-idempotent resources, the upgrade fallback, ledger-unavailable
fallback. Keyed lock: serialization, order, release on throw. Startup
reconcile of `opening` records.

## Phase 2, slice 6 technical plan: VS Code windows (2026-10-29, draft)

**Finding:** the companion extension isn't installed on the founder's
Mac — it has only ever run in the F5 Extension Development Host. Every
per-window mechanism below needs it, so this slice adds
`npm run install:vscode-extension` (esbuild → `vsce package` → `code
--install-extension`). Bundling/auto-installing it from the app stays
out of scope (known limitation).

- **Identity:** `{ bundleId, folder }` — the VS Code app the step opens
  (VS Code vs Insiders vs Cursor) and the folder, lexically normalized.
  One window per folder is VS Code's own rule.
- **Heartbeat v2** (extension → app, the existing
  `vscode-current-state` files): adds `sessionId` (`vscode.env.sessionId`,
  unique per window), `activatedAt`, `appRoot` (→ bundle id) and
  `folderCount`; multi-root windows are never tracked or commanded.
  v1 readers (Save-current detection) keep working.
- **No restore slowdown:** capture doesn't wait for VS Code + the
  extension to start. The handle is `{ bundleId, folder, sessionId:
null }`; the first check that sees a heartbeat for that folder with
  `activatedAt` after the record was written binds its `sessionId`
  (check may return an updated handle). A heartbeat already there
  before the open → that window pre-existed → not ours.
- **Command channel** (app → extension): `vscode-commands/cmd-<id>.json`
  `{ id, sessionId, action: 'close', createdAt }`; the extension
  watches the directory (+ 1.5s poll), only executes commands for its
  own sessionId, ignores anything older than 10s and everything already
  present at activation; answers with `ack-<id>.json` `{ status: 'ok' |
'refused', reason }`. Close refuses when any document is dirty
  (`kept-running`, "has unsaved changes") and otherwise runs
  `workbench.action.closeWindow`.
- **Check:** fresh heartbeat with the bound sessionId → alive; a
  different sessionId for the folder → the user reopened it → gone (not
  ours any more); no heartbeat and VS Code not running → gone; no
  heartbeat but VS Code running → unknown (kept).
- **No-extension fallback (founder, 2026-10-29):** Close never quits
  VS Code when a window can't be tracked — it's left open with the
  reason ("needs the VS Code extension to close just this window"),
  never quitting the user's other windows. The upgrade fallback skips
  VS Code steps for the same reason, and an app resource for VS Code
  (a link opened in it) is never quit while a VS Code window resource
  is owned (the plan's "app-quit blocked while any owned resource of
  that app is in use").
- **Terminals restore** (pending-restore files) is unchanged.
- **Tests:** heartbeat v2 + command/ack files as pure shared functions
  (both sides), the kind against a fake heartbeat/command directory,
  the extension's command handling with a mocked `vscode` API.

## Phase 2, slice 7: upgrade path (2026-10-29, scoped down)

The intent flag can only be retired once every step kind is tracked —
Terminal, Tilt and Chrome stay untracked until phases 3–4, and they
still need intent + app-level liveness. So this slice only does what's
possible now:

- **Activity:** a tracked step counts towards "active" only through the
  ledger, never by app name — a workspace made active before tracking
  existed no longer shows active just because its app (VS Code, for a
  link step) is open for something else. Fixes the stale green badges.
- **Upgrade close:** unchanged — a tracked step of a workspace still
  active through its untracked steps, owning nothing, gets the
  app-level close once (never for VS Code). A workspace with only
  tracked steps and nothing owned is simply inactive: there's nothing
  this app provably opened to close.
- **Still to do (after phases 3–4):** retire `workspace-activity-store`
  entirely once no step is untracked; make the ledger the only source of
  "active".

## Phase 3 technical plan: Terminal + Tilt windows (2026-10-29, draft)

Spike (2026-10-29, this Mac): a title set by the generated script
(`printf '\e]0;MARKER\a'`) shows up in Terminal's AX window title
(`stas — MARKER — sleep … — 120×30`), so a per-terminal marker is
enough to tell which new window is whose, even when one step opens
several.

**3a — terminal windows (fixes the motivating Retry bug).**

- One resource per terminal entry of a Terminal step. Identity: `{ app:
Terminal, cwd (normalized), commands, occurrence }` — occurrence
  tells two identical entries apart. Marker = a short hash of the
  identity, shared by `resources()` and `run()` so the script sets it
  and capture looks for it.
- The script sets the marker title first, then writes `{ tty, pid }`
  of its shell to a per-marker info file (start time read via the
  helper's `processStartTime`).
- Helper: `captureNewWindow` gains `titleContains`, so capture is
  "the new Terminal window whose title has my marker" — no ambiguity
  when a step opens three at once.
- Check: window alive (held AX ref) and the recorded shell alive (pid
  - start time + tty all match); shell `cd`'d elsewhere → drifted
    (decision 4).
- Close: SIGHUP the recorded shell's descendants (never "everything on
  the tty"), SIGKILL leftovers after 1.5s, then press the window's
  close button; a dialog anyway → refused, never auto-confirmed.
- Non-idempotent: an open window is reused (not reopened); Retry closes
  the step's own window first, then opens a fresh one.
- Known limitations: users with "open new windows as tabs" get tabs —
  background tabs can't be closed, only their processes stopped;
  Terminal.app only (iTerm2 untested).

**3b — re-run loop (decision 2).** After the commands finish, the
script records the exit code and waits instead of dropping to a shell:
a re-run request from the app (a per-marker control file) runs the
commands again in the same window; any keypress drops to the normal
shell and marks it `user-took-over` (never auto-closed after that). A
restore that finds the window alive but its commands done re-runs them
there instead of opening another window.

**3c — Tilt.** A Docker step on the Tilt engine is the same terminal
kind (a Terminal step running `tilt up` in the same dir shares its
identity). Close with stop-on-close on: SIGINT `tilt up`, wait, `tilt
down` (the step's Down command), then close the window; off → window
stays, `kept-running`.

**Other desktops (found 2026-10-29, real Tilt test; founder decision):**
a terminal opened while the user is on another desktop (or in a
full-screen app) opens where Accessibility can't see it, so capture
finds no window. It's tracked through its shell anyway (window id
unknown); closing it brings Terminal forward — switching to that
desktop — finds the window by its marker, stops the processes, then
closes it. A known window that moved to another desktop is closed the
same way. Verified for real: Tilt captured off-desktop, Ctrl+C →
`tilt down` (deployment gone) → switched → window closed, 1.7s.

**3d — detection without AppleScript.** "Save current workspace" finds
terminals via `ps` (+ `lsof` for cwd) instead of `tell application
"Terminal"` — no Automation prompt, and fixes `tee` being reported as
the command.

**Dropped (founder, 2026-10-29): VS Code without the extension.** With
the first-run tour installing the extension (and in-VS Code terminals
needing it anyway), almost every VS Code user will have it; a
helper-only fallback would add title-matching for the rare user who
skips it. Without the extension VS Code stays open, with the reason.
Revisit only if real users skip it and complain.

Order: 3a → 3b → 3c → 3d, each hand-checked before the next.

## Phase 4 technical plan: browser windows, Chrome first (2026-10-30, spike passed, draft)

Correction to an earlier claim: Chrome is already never quit
(`isExcludedFromAutoClose`), and today a Chrome step's tabs are never
closed either — they pile up as duplicate tabs on every Restore.

### What the user gets (founder decisions, 2026-10-30)

- **One window per Chrome step**, named after its workspace through
  Chrome's own "Name window" (visible in Mission Control / Window menu).
- **Restore**: the window is reused if it's open; otherwise it opens
  with the tabs saved last time (first time, or nothing saved: the
  step's URLs). Only the first tab loads; every other tab is a
  placeholder that loads the moment it's clicked — no load spike.
- **While the workspace is active**, the window's tabs are saved
  whenever they change (Accessibility change signals, ~2s debounce) —
  so closing the window by hand loses nothing. No polling.
- **Close / Switch**: save the tabs, then close the window, whatever it
  holds — tabs opened and closed while working are the workspace's
  session, never "the user's". The same step in the target workspace
  → the window is handed over (and renamed) instead. Chrome itself and
  windows the app didn't open are never read, saved or closed.
- **Chrome restart or crash**: the window is found again by its name
  and re-adopted — no duplicate.
- **"Leave site?" blocks the close** (unsaved page input): the window
  stays open, the workspace stays active, and the app shows its own
  clear message naming the site — never a silent failure.
- **Editing the step's URLs** resets its saved tabs to the new list.
- **Permission**: "control Chrome" (Automation) — to be asked in the
  first-run tour; until the tour exists, at the first Restore of a
  Chrome step (never mid-Close). Denied → the window still opens with
  the step's URLs, but Close leaves it open and says why: tabs are
  never closed unsaved.
- **Not kept**: tab groups (tabs come back ungrouped — Accessibility
  can see groups, nothing outside Chrome can recreate them), page state
  (scroll, typed input). Incognito windows are never read. A window
  that opens on another desktop / behind a full-screen app can't be
  caught → the step works, untracked, with a message.

### Spike results (`spikes/chrome-windows/`, this Mac, Chrome running)

| Check                      | Result                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--new-window` + URLs      | one new standard window holding all URLs; caught alone by the window diff (~7s); AX close closed it, no prompt                                              |
| Change signals             | every action sends one: tab opened/closed/switched, link followed, window opened/closed (`AXTitleChanged` on the window and tab buttons, created/destroyed) |
| Cost of listening          | Chrome idles at 0.3–0.8% CPU with the observer on — no measurable cost; page content is noisy (video timers) and filtered out by role                       |
| Reading tabs (scripting)   | every tab's title + full URL (18/18)                                                                                                                        |
| Matching windows           | scripting bounds = AX frame exactly; AX title = active tab's title                                                                                          |
| Window name (`given name`) | settable; survives ⌘Q + reopen and a force-kill + crash restore; Chrome's own window id changed every time — the name is the anchor                         |
| Placeholder tabs           | a `data:` page with the real title stays unloaded until selected, then replaces itself with the real URL                                                    |
| Accessibility alone        | reads tab titles and groups ("Part of group …") but not URLs — so the Chrome permission can't be avoided                                                    |

Chrome loads every URL passed on the command line immediately (all 5
test tabs had their real titles within seconds) and offers no outside
way to open a tab unloaded (only extensions can discard tabs) — hence
the placeholders.

### Browser base (built for more than Chrome)

Everything browser-specific sits behind one **browser adapter**: open a
window (profile, tabs, lazy), read windows with their tabs, name a
window. Watching for changes is Accessibility — the same for every
browser. Each adapter declares what it can do; a missing capability
degrades with a message, never silently. Chrome first; Brave and Edge
share Chrome's scripting vocabulary (parameterized by app); Arc to be
verified; Safari (scripting, no window names) and Firefox (no tab
scripting — extension only) later.

### Slices

1. **Helper change events** — `observe(pid)` / `unobserve(pid)`: the
   helper pushes event lines (window title changed, window
   created/destroyed, tab-strip title changed) for that app, filtered
   by role so page content never reaches the app; the client exposes
   them as events. Real check on Chrome.
2. **Chromium adapter** — scripting through `osascript` with every
   value passed as an argument (never spliced into script text): read
   windows (name, bounds, tabs), name a window, close nothing (closing
   stays AX). Opening: one `open -n -a <browser> --args
--profile-directory=<p> --new-window <tab1> <placeholders…>`;
   placeholders built with escaped title/URL, and decoded back to the
   real URL when tabs are read.
3. **Saved tabs** — per workspace step, persisted next to the ledger;
   stored with the step's configured URLs so an edit resets them.
4. **`chrome-window` kind** — identity `{browser, profile, configured
URLs}` (two workspaces with the same step share one window). Handle:
   pid + window id + its name. capture = window diff, then name it;
   check = window state, and a gone window is looked for by name before
   it counts as gone (restart/crash); close = save tabs → AX close →
   a dialog → `refused` with the site; reconcileOpening = find by name.
   Opens serialized behind one lock so concurrent opens can't swap
   windows.
5. **chrome-tool** — `resources()`, run (reuse / open with saved or
   configured tabs), the change watcher started and stopped with the
   workspace's activity, permission check + interim prompt.
6. **UI** — the blocked-close message; permission denied message.
7. **Tests** (adapter argv + placeholder escaping, kind with a fake
   helper/adapter, tool, orchestrator: Close closes and saves, Switch
   hands over, restart re-adopts) and hand tests on the Mac.

**Built (2026-10-30), uncommitted, waiting for the hand test.** Real
checks on this Mac: helper events (open → events, idle → none), tab
titles via AX, the adapter (read 19/19 tabs, name, active tab), and an
end-to-end open → name → save on Close → reopen with the saved tabs on
the saved active tab → close. Differences from the plan above:

- No launch lock: the helper's capture already refuses when two new
  windows appear at once, and the script-id diff (+ first-tab match on
  a cold start) picks the right window to name — concurrent opens end
  untracked with a reason, never swapped.
- The first tab always opens for real (Chrome always shows it), every
  other web tab as a placeholder; the saved active tab is then
  selected, so at most two tabs load.
- `chrome://` tabs are dropped by Chrome when passed on the command
  line — not restored (rare: settings pages).
- Tab reads fetch each window's titles and URLs in one request and
  retry when the user changes tabs mid-read (seen once for real).
- **Review round (2026-10-30, two agents):** identification rebuilt so a
  window counts as the step's only when independent signals agree —
  the one new window Accessibility saw, the one new browser window
  holding exactly the tabs opened, the same frame; after naming, and
  before every save or close, exactly one non-incognito window carries
  the name and exactly one on-screen window has that exact title and
  frame. Unnamed / unconfirmable windows aren't tracked (the step still
  opens). While the browser is quit the window is 'unknown' (kept,
  found again by name), so the workspace still shows active then.
  Saves also trigger on tab switches / same-title navigation (selected
  tab + active URL via AX), are guaranteed every 10s under constant
  change, and only remember a state once saved. Page titles can't forge
  records (separators stripped in the script); incognito tabs are never
  read; flag-like "URLs" are refused. Helper: watches re-sent on every
  ready, failed attaches retried, retries stop once unwatched.
- Browser-step opens go through the platform launcher
  (`openBrowserWindow`) — tests that fake the launcher can never open
  real windows (an earlier draft shelled out directly and a test run
  opened ~15 real Chrome windows; closed by hand).
- Saved tabs aren't pruned at startup while any Chrome step can't be
  resolved (its saved tabs must never be lost to a passing failure).
- **Wrong-window guard (found for real, 2026-10-30):** an end-to-end
  check caught — and later closed — the founder's own main Chrome window
  (reopened with ⌘⇧T). Most likely cause: the pre-open window list
  failed and was treated as empty, so an existing window looked new.
  Now: an unlistable snapshot never captures; a caught window that
  doesn't show the name it was given isn't tracked; and Close only ever
  closes a window whose title still carries that name.

- **Cold start (found and verified for real, 2026-10-31):** opening a
  profile together with URLs makes Chrome reopen the profile's session
  and drop the URLs into one of those windows (and a plain start can
  stop at the "Who's using Chrome?" picker). Now the profile is opened on
  its own first, the step waits until its windows are back, then opens
  its window into the running profile — always a window of its own.
  Capture identifies the window through Chrome's view (one new unnamed
  window holding exactly the opened tabs) then confirms it on screen by
  name + frame, so several windows reappearing at once is fine; a copy
  of the workspace's own window that Chrome reopened by itself is
  closed (its tabs were saved). A quit browser = the window is gone.
  End-to-end on the founder's Chrome: quit → Restore → main window back
  untouched + exactly one named window → Close closed only that.

**Built (founder decision, 2026-10-31):**

1. Drop the Chrome step's URL field: the step only picks the profile;
   its window reopens the tabs last open in it (first Restore = an empty
   window; existing steps' URLs seed the first Restore once). Identity no
   longer includes URLs — each workspace's step owns its own window.
2. Workspace names must be unique (case-insensitive) — create/rename
   refuse a duplicate with a clear error; window names then always match
   their workspace ("(2)" stays only for a clash with the user's own
   Chrome window names).
   Still to hand-test: a page asking before it closes (Close keeps the
   window and names the page); Switch to a workspace without Chrome closes
   only the workspace's window.

**Open questions for building:** naming when two workspaces share a
window or have the same name (rename on hand-over; keep names unique
among open windows); whether Chrome's "Leave site?" dialog is visible
to Accessibility so its site can be named (else a generic message).

## Status

Idea approved, research + spike done, Stage 2 plan approved
(2026-10-28). **Phase 1 built and hand-checked (2026-10-29)** in a
packaged build — onboarding, grant detection, reduced-mode banner,
Settings row and ER-PERM-01 all confirmed by the founder:

- `apps/desktop/native/wl-helper/` (Swift) — `serve` / `trust`, built
  universal by `npm run build:helper`; `scripts/check-helper.mjs` is
  the manual real-Mac check (passes on macOS 26.6: trust, listing,
  capture → state → focus → close → gone → quit on TextEdit).
- `main/platform/macos/wl-helper-client.ts` — not wired to any caller
  yet (phase 2's first user).
- Accessibility check, onboarding modal, reduced-mode banner, Settings
  row, ER-PERM-01 + ER-SYS-03 (helper unavailable).
- Ships in `Contents/Helpers`; `afterPack` fails the package without a
  universal helper.

Found on the real Mac while building: an app still launching answers
Accessibility with "cannot complete" (capture now keeps polling), and
the system window list keeps a just-closed TextEdit window too, not
only Chrome (the helper remembers windows whose held reference died).

Packaging (2026-10-29): `package:mac` was failing before packing
("Cannot compute electron version" — Electron is hoisted to the
monorepo root); it now passes the installed version explicitly. Local
test builds use `npm run package:mac:dev`, signed with a self-signed
"Workspace Launcher Dev" identity (one-time per Mac:
`scripts/create-dev-signing-cert.sh`), so the designated requirement —
and with it the Accessibility grant and Keychain access — stays the
same across rebuilds. Ad-hoc signed builds lose the grant on every
rebuild ("Failed to match existing code requirement" in tccd's log);
reset with `tccutil reset Accessibility com.workspacelauncher.app`.

tccd's own log confirmed finding C in the real Electron app: the
helper's checks are attributed to `com.workspacelauncher.app`.

Open UX question (founder, 2026-10-29, slice 4 hand-check): Close
leaving an app the user had opened themselves running ("Left ProtonVPN
running (it was already open before this workspace)") follows
decision 1 but may not feel intuitive — revisit before release.
Same question for terminals (founder, 2026-10-29, phase 3a/3b
hand-check): a terminal the user pressed a key in ("you've used it
since — left open for you") is never closed by Close — confirmed
working, but the founder isn't sure it's the right call; decide
together with the user-opened-app case.

Follow-up after window tracking is finished (founder, 2026-10-29):
redesign the Detail view after Close / Switch. Today it stacks the
close report ("Closed Figma.", "Left ProtonVPN running (still used by
Proton).") as banner rows above the stale "Restored — 2 of 3" result
and the "Runs in order on restore" list, which reads as if nothing
changed. Decide what a closed/switched workspace shows instead — run
it through /judge.

Follow-up after window tracking (founder, 2026-10-29): adding a step
takes too many clicks (⋯ → Edit → Add tool → App → Choose app). Idea:
an "+ Add step" button at the end of the Detail view's step list —
pick a tool, and for App open the macOS app picker straight away (~2
clicks, no Edit form). Same pass: the "Use VS Code's folder: …"
suggestion chip on a Docker/Terminal step is too faint to notice
(founder missed it, 2026-10-29) — make it prominent, or pre-fill the
directory from the VS Code step with an easy way to change it. Do it
together with the Close/Switch view redesign above, through /judge.
Same pass: the sidebar's status badge is solid red for a step that
"started, then failed" (terminal opened, a command failed) while the
Detail strip shows that step half green / half red (founder,
2026-10-29) — make the two agree.

Follow-up (founder, 2026-10-30): global keyboard support for every
dialog and modal (confirmations, Edit form, Save current, etc.) — Esc
cancels/closes, Enter runs the primary button (confirm / submit / save).
One shared behavior in the dialog component, not per-dialog wiring
(StepChangeConfirm already passes onEnterKey; make that the default).

Follow-up (founder, 2026-10-30) — local Kubernetes cluster handling,
plan through /judge: closing a Tilt step runs `tilt down`, which empties
the cluster but leaves the cluster itself (kind/k3d/minikube) running —
and two projects with rich clusters running at once is too heavy when
switching. Idea: a Docker step knows its cluster (detected from the
Tiltfile / kubectl context, or picked); Restore starts it if stopped,
Close/Switch with stop-on-close stops it (keeps its state, fast to
resume) unless another workspace still uses it. Ownership question to
settle: today a cluster the user created is "theirs" and never touched.

Follow-up (founder, 2026-10-30) — redesign the Save current workspace
view: the modal is too narrow to read what was detected (long paths,
commands, several terminals and windows stacked in expand-in-place
rows). Needs a wider, scannable layout — plan through /judge.

Follow-up (founder, 2026-10-31): when every step was already open
("Already open — reused"), the Detail header still says "Restored — 1
of 1 steps succeeded · 0.0s" — say "Already open" instead.

Follow-up (founder, 2026-10-30): while a workspace is restoring,
closing or switching, the ⋯ menu next to Restore/Close (Edit, Delete,
etc.) is still clickable — disable it for the duration, like the
Restore/Close button itself.

**Important open product question (founder, 2026-10-29):** users
shouldn't silently run without what the app needs. Idea: a first-run
setup tour that gets everything enabled up front — Accessibility, the
VS Code extension (installed from the app), Docker, etc. But not every
user uses VS Code (or Docker, or Chrome), so the tour has to know the
user's domain/stack first → onboarding "templates" (e.g. "fullstack web
dev: VS Code + Docker + Chrome") that decide which requisites to ask
for, and possibly seed a first workspace. Touches onboarding, the
extension bundling limitation, and workspace templates — needs its own
/judge before the validation build, not a quick add.

Added (founder, 2026-10-30): the tour is where **every** permission is
asked — together, once, up front — never as prompts popping up later
mid-action. It starts by asking what the user will use the app for
(e.g. "development", "everyday use", or both) and asks only for what
that needs: Accessibility for everyone who tracks windows; "control
Chrome" (Automation, needed to save a Chrome step's tabs — Phase 4)
only for Chrome users; VS Code extension / Docker checks only for
developers. Known so far: Accessibility can read a tab's title and its
group but not its URL, so the Chrome permission can't be avoided for
saving tabs; import/export through the file picker needs none.

Next: phase 2.
