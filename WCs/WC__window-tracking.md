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

## Status

Idea approved (expanded scope), research and spike done. Next:
`/judge` Stage 2 — the concrete technical plan — after the current
end-to-end testing pass, starting with the background-focus spike.
