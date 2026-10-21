# Global hotkeys — per-workspace Restore/Switch, tray/background persistence, launch at login

A keyboard shortcut per workspace that works even when Workspace
Launcher isn't focused — or isn't even open a window, as long as the
process hasn't been fully quit. Pulled forward from `docs/build-shell.md`'s
Tier 3 by explicit founder authorization (2026-10-21/22), the first of
three "widen appeal without adding more app integrations" ideas. Went
through a full `/judge` round (Stage 1 idea approval, Stage 2 technical
plan with an adversarial review pass) before any code was written.

## Revised after real usage (2026-10-22)

Shipped once, then used for real and corrected twice the same day:

1. **"its better to have the hotkey under each ws instead of once in
   settings"** — the original Settings → Workspace hotkeys section (a
   flat, searchable list of every workspace) was removed entirely.
   Setting a hotkey now happens inline on the workspace itself
   (`Detail.tsx`'s metadata-pill row, next to "N tools" and the
   launch-time pill) via a new, self-contained
   `WorkspaceHotkeyControl.tsx` — no more hunting through a list
   somewhere else for the one workspace you're already looking at.
   `WorkspaceHotkeyRow.tsx` (the list-row version) was deleted outright
   rather than left as dead code.
2. **Before-quit interception broke `npm run dev`'s own hot-restart.**
   Confirmed immediately after the relocation above (blank white window,
   `ERR_CONNECTION_REFUSED` loading the renderer dev server) — electron-
   vite's file-change-triggered restart sends the running process a
   real quit, which `before-quit` was intercepting unconditionally,
   same as a production quit. The old process never actually exited; it
   backgrounded itself and kept holding the single-instance lock while
   electron-vite spawned a fresh process that immediately lost the lock
   race and exited, while the zombie process's `second-instance`
   handler recreated a window against its own now-stale
   `ELECTRON_RENDERER_URL`. Fixed: `before-quit` interception is now
   gated behind `!is.dev` — production keeps the full tray/background
   policy, `npm run dev` gets the exact pre-feature quit behavior back
   (electron-vite's restarts actually restart). Not a hypothetical
   edge case — this is the exact "verify empirically during that
   workflow" risk flagged, and left unresolved, in this doc's first
   version.
3. **"i pressed cmd ctrl C and it only registered cmd C"** — a real
   bug, not a quirk: `baseComboFromEvent` (`lib/workspace-hotkeys.ts`)
   only ever consulted `e.ctrlKey` for the `CommandOrControl` token on
   non-mac; on mac, a literal Control held alongside Cmd was silently
   dropped, since Electron's accelerator vocabulary treats `Control` as
   a *distinct* modifier from `CommandOrControl` (Cmd) and nothing
   captured it. Fixed: on mac, `e.ctrlKey` now also independently
   contributes a `Control` token alongside whatever `CommandOrControl`/
   `Alt` tokens are present. Regression-tested
   (`workspace-hotkeys.test.ts`).

## Second round of usage feedback (2026-10-22)

1. **"its not really clear for users what it does"** — the pill's idle
   label changed from the generic "Set hotkey" to "Global hotkey" (the
   word "global" is doing real work: it's the one-word signal that
   this isn't just another in-app shortcut). Once a combo is bound, the
   pill shows the combo AND its action inline (`⌘⌥1 → Restore`) instead
   of just the bare combo — what it's actually bound to do is now
   visible without hovering. The recording-state label changed from
   bare "Press keys…" to "Press keys for Restore…" for the same reason.
   Tooltips were also rewritten to lead with "works even when
   Workspace Launcher isn't open" rather than assuming that's already
   understood.
2. **Real bug, caught from a live screenshot**: macOS's own "Login Item
   Added" system notification named the registered app **"Electron.app"**,
   not Workspace Launcher. Root cause: `app.setLoginItemSettings`
   registers whatever's actually on disk at the running process's
   executable path — in an unpackaged dev build (`npm run dev`) that's
   the generic, shared `node_modules/electron/dist/Electron.app` binary
   every electron-vite project uses, not a real "Workspace
   Launcher.app" bundle. `app.setName(PRODUCT_NAME)` doesn't change
   this — it only renames the app for Electron's own internal APIs
   (paths, notification grouping), not the OS-level bundle identity a
   login-item registration is tied to. Fixed: `setLaunchOnLogin(true)`
   now refuses outright on an unpackaged build
   (`GetLaunchOnLoginResult`/`SetLaunchOnLoginResult` gained an
   `available`/refusal path keyed off `app.isPackaged`), with the
   Settings toggle disabled and an inline "Not available in a dev
   build" note. Turning it back OFF is deliberately still always
   allowed, even unpackaged — someone needs a way to clean up a login
   item a pre-fix dev build already registered, without System Settings
   being the only way out.
   **Action needed, not fixable from code**: if you toggled this on
   while testing before this fix, macOS still has a real
   "Electron.app" login item registered on your machine right now —
   either flip the (now-still-clickable) toggle off once from Settings,
   or remove it directly via System Settings → General → Login Items
   & Extensions.

## Fifth round — the SAME mac-Control bug, in the other shortcuts system (2026-10-22)

"for settings - they dont support >2 keys rn" — confirmed: the in-app
Shortcuts recorder (`ShortcutRow.tsx`'s `comboFromEvent`, a completely
separate module from this feature's own `lib/workspace-hotkeys.ts`)
had the exact same mac-only bug found and fixed earlier in this doc
(round two): `e.ctrlKey` was only ever consulted for the
`CommandOrControl` token on non-mac, so a literal Control held
alongside Cmd on mac — e.g. `⌘⌃S` — silently registered as just `⌘S`.
It wasn't a real "more than 2 keys" cap anywhere in the code (nothing
limits modifier count); it was this same dropped-modifier bug making
it look that way. Fixed identically: `isMac && e.ctrlKey` now also
pushes a distinct `Control` token. No dedicated test added —
`comboFromEvent` is private to the component (not exported, matching
this codebase's "no new renderer component tests" convention), and the
fix is the exact, already-tested logic from
`workspace-hotkeys.test.ts`'s mac-Control regression tests, just
applied to the sibling module.

**The actual standard** (asked directly: "whats the standard? contain
as many tab/cmd/ctrl as u want and a key?"): zero or more modifier
keys — Cmd/Ctrl/Option(Alt)/Shift on mac, Ctrl/Alt/Shift/Win on
Windows — plus exactly ONE non-modifier "main" key (a letter, digit,
function key, arrow, Tab, Space, Enter, punctuation, etc.). Tab itself
is a main key, not a modifier — it's held down position doesn't
combine with other keys the way Cmd/Ctrl/Alt/Shift do. Convention
(and this app's own `validateCombo`) also requires at least one
modifier for anything beyond a few reserved single keys, so it doesn't
collide with normal typing. Both this app's hotkey systems now
correctly support any combination of the four real modifiers plus one
main key — no artificial cap.

## Fourth round — the explanation was never actually visible (2026-10-22)

"Global hotkey for that is also unclear. And we never say anything abt
shift. we need to properly serve the feature to the users." Correct,
and a pattern across this whole session: every explanation so far
(the word "global," the Restore/Switch split, the "works even when
closed" behavior) lived in a hover `title` attribute — technically
present, practically invisible. Renaming labels again wasn't going to
fix that; the fix is a real, click-to-open explanation that actually
gets seen:

- Unset label simplified again: "Add hotkey" (the word "global" was
  itself part of the problem — jargon that didn't land, not a useful
  signal).
- A new, always-visible info-icon button sits next to the pill
  (`icons.tsx`'s new `info` glyph), reusing `DropdownMenu`/
  `DropdownMenuContent` (already in this codebase, already handles
  positioning/outside-click/Escape-dismiss — not a new dependency or a
  hand-rolled popover) to show a short, persistent explanation on
  click: that it's systemwide and works even when the app is closed,
  and — explicitly, finally, in actual visible text — that the base
  combo restores and holding Shift too switches instead, with both
  real key combos spelled out once one is bound.
- The hover `title` attributes that used to carry this explanation
  were removed from the main pill button entirely (redundant now, and
  hover-only text is exactly the discoverability failure being fixed
  here) — the needs-re-pick title stays, since that one's a real,
  specific error state, not general feature explanation.

## Third round — the disabled-toggle fix itself was the bug (2026-10-22)

The previous round's fix (disable the toggle in a dev build, with a
small "Not available in a dev build" caption) was itself a UX mistake,
caught immediately from a screenshot: "cannot toggle it off from here.
why? ... on light theme also its not visible." Two compounding issues:

- The explanatory caption (`text-text-faint`, 11px) had borderline
  contrast against this app's light-theme background — easy to miss
  entirely, so the disabled control just looked broken with no visible
  reason.
- The toggle's knob (`bg-white`) had no visual separation from its own
  "off" track color (`bg-bg-elevated`, near-white in light theme) —
  independent of the disabled-state question, the control was close to
  invisible in light mode generally.

Fixed by reverting the preemptive-disable approach entirely, not just
patching its contrast: the toggle is **always clickable** now,
regardless of build. An attempt to turn it ON in a dev build is still
correctly rejected (the real fix from the previous round —
`setLaunchOnLogin`'s `app.isPackaged` guard — is untouched), but the
rejection now surfaces through the exact same red-error-text path
(`launchOnLoginError`) every other failed action in this app already
uses, instead of a novel silent-disable pattern invented just for this
one control. `GetLaunchOnLoginResult`'s `available` field (added last
round to drive the preemptive disable) was removed again — nothing
reads it anymore, and leaving it would be dead plumbing. Separately,
the knob now has a subtle drop shadow (not a border/fill color choice)
so it stays visibly distinct from its track regardless of theme or
state — a more robust fix than trying to pick two more-contrasting flat
colors for an off-state that already has to span both themes.

## Follow-up review pass (2026-10-22)

Requested explicitly ("check for other handy/comfortable fixes... edge-
cases, bugs") after the two real bugs above. One more real bug found
by reasoning through the sync logic, not observed live:

- **Setting a new workspace's hotkey to a combo another workspace
  already owns could silently break the OTHER one, with no error
  shown at all.** `syncHotkeys()` re-registers every binding fresh
  from a plain `Record<workspaceId, combo>`, iterated in object
  insertion order — whichever workspace bound a hotkey *first*, not
  whichever request is in flight. If workspace B already owns a combo
  and workspace A's `setWorkspaceHotkey` call persists the same combo
  for itself, the `failed` list from that sync attributes the loss to
  whichever of the two iterates *second* — which could be B, not A.
  The original code only checked `failed.includes(workspaceId)` for
  the workspace being edited (A), so if B was the one that ended up
  failing, A's request returned `{success: true}` while B's
  previously-working hotkey silently stopped firing — a real violation
  of "fail loudly, never silently," and worse than the "another app
  owns it" case because there wasn't even an error to see. Fixed:
  `setWorkspaceHotkey` now explicitly checks for an intra-app
  collision by name *before* touching the store at all, rejecting with
  "Already bound to \"X\"" — clearer than the generic "already in use"
  message too, since we actually know who owns it when it's our own
  binding.
- Polish: the "needs re-picking" red styling could show next to a
  plain "Set hotkey" label if a stale `getFailedWorkspaceHotkeys()`
  snapshot briefly disagreed with a just-cleared binding — gated on
  `combo !== undefined` now, so it only ever appears alongside an
  actual combo.
- Reviewed and found NOT to be bugs: workspace duplication doesn't
  exist in this codebase, so there's no "does a duplicated workspace
  inherit the original's hotkey" case to worry about; `Detail.tsx`
  fully remounts per workspace (`key={workspace.id}`), so
  `WorkspaceHotkeyControl` never carries stale recording state across
  a workspace switch; re-recording a workspace's own existing combo
  back onto itself correctly isn't flagged as a collision with itself.

## What it does

- **Per-workspace, optional**: each workspace can have ONE recorded
  base accelerator (e.g. `⌘⌥1`). Most workspaces have none; bind your
  1-2 most-used ones right on the workspace itself (Detail view's
  pill row).
- **Base combo → Restore. Base combo + Shift → Switch.** Two live OS
  registrations per binding, not one — Electron's `globalShortcut`
  treats `Cmd+Alt+1` and `Cmd+Alt+Shift+1` as entirely unrelated
  strings, so the Shift variant is a second registration, always
  derived from the base (`switchAccelerator()` in
  `packages/shared/src/accelerator.ts`), never independently recorded.
  Shift is reserved out of the base combo entirely for this reason.
- **Works even after the window is closed, or the app was never
  opened this session but is still running.** Workspace Launcher now
  lives in the macOS menu bar (a Tray icon) instead of quitting when
  its window closes — see "Tray / background persistence" below.
- **No feedback on success** — the launched apps are the confirmation.
  A native macOS notification appears only on failure (a step failed,
  or the triggered action itself threw), since there's often no window
  open to show a results list in.

## Why this shape (the three questions the founder named)

1. **Collision with this app's own in-app shortcuts
   (`lib/shortcuts.ts`)** — not reused. That system is renderer-only
   (in-app `keydown` matching, localStorage-persisted, explicitly
   documented as never wired to the main process). A global hotkey
   needs OS-level registration via Electron's `globalShortcut`, which
   only the main process can do — a fundamentally different mechanism,
   not a variant of the existing one. `hotkeys:setBinding` does
   independently validate the combo against the same "well-formed
   accelerator" shape both systems care about, but via its own shared
   validator (`accelerator.ts`), not by calling into `lib/shortcuts.ts`.
2. **Collision with the OS or other apps** — `globalShortcut.register()`
   returns a boolean ("whether or not the shortcut was registered
   successfully"); a silent OS-level refusal (another app or macOS
   itself already owns the combo) returns `false` rather than throwing,
   and there is no API anywhere to learn *which* app owns it. The
   recorder attempts live registration as part of saving
   (`hotkeys:setBinding` → `syncHotkeys()`), and surfaces "already in
   use" immediately rather than a generic error. Every stored binding
   is also re-synced fresh on every app launch, since a successful
   registration today isn't a lifetime guarantee (macOS version
   changes, keyboard layout changes); a binding that fails to
   re-register shows a "needs re-picking" indicator in Settings rather
   than silently going dead.
3. **What one hotkey actually triggers** — per-workspace (not "the
   selected/pinned workspace," which would be an implicit, invisible
   binding with no predictable meaning when fired blind), and it maps
   to Restore/Switch via the Shift modifier rather than needing a
   second recorded combo per workspace.

## Tray / background persistence

Closing the window no longer quits the app — it's destroyed (not
hidden; see "Why destroy, not hide" below) and the process keeps
running with a menu-bar Tray icon as its only visible trace. The tray
menu has "Open Workspace Launcher" and "Quit Workspace Launcher" — the
latter is now the *only* path that actually exits the process. Every
other quit trigger (⌘Q via the app menu's default Quit role, the
window's own close button reaching zero windows, a plain `kill <pid>`)
backs the app off into the tray instead, via a single `before-quit`
chokepoint in `main/index.ts` gated on an `isQuittingFromTray` flag set
only by the tray's own Quit click.

**Known, accepted behavior change**: a plain `kill <pid>` (SIGTERM, not
`-9`) no longer terminates the process — Electron's default SIGTERM
handling calls `app.quit()`, which `before-quit` now intercepts the
same as every other quit trigger. This matches every other menu-bar
utility (Slack, Discord, Bartender, ...) and is intentional, not an
oversight.

A one-time native notification ("still running in the menu bar...")
shows the first time ever the window closes to the background
(`settingsStore`'s `hasShownBackgroundNotice`), explicitly never on a
genuine tray-initiated quit (`window-all-closed` still fires on the way
to a real exit — Electron's quit order is `before-quit` → each
window's `close` → `window-all-closed` → `will-quit` → `quit` — so
this is gated on `!isQuittingFromTray` to avoid telling the user "still
running" at the exact moment the app is exiting).

### Why destroy the window, not just hide it

The founder's own prediction: this will be a frequently-used, often-
backgrounded feature. A hidden-but-alive window keeps its full
Chromium renderer resident (commonly 80-150MB for even a small single-
page app) for however long it sits backgrounded, which could be most
of a workday. Destroying it on close and lazily recreating it on
demand (`showOrCreateMainWindow()`, reusing the existing mac
`app.on('activate')` dock-icon-click pattern) drops the background
footprint to just the main process — no resident renderer at all —
at the cost of a brief reload when the window is reopened. This is
free precisely because the hotkey path never needed the window in the
first place: `restoreWorkspaceWithFocus`/`switchWorkspace`
(`ipc/handlers.ts`) already run entirely in the main process; the
window is purely a UI convenience for looking at something, not a
dependency for Restore/Switch to work.

### Launch at login

`settings/store.ts`'s `AppSettings.launchOnLogin` field existed
already, stubbed and completely unwired. Now wired end-to-end: a
Settings toggle (default off) calling `app.setLoginItemSettings`, with
the *getter* always reading the OS's own live `getLoginItemSettings()`
state (and syncing it back into the store) rather than trusting a
possibly-stale persisted value — the user can also change this
directly via macOS System Settings → Login Items, and this app should
never disagree with what the OS actually has registered.

## Known limitations (flagged, not silently absorbed)

- **Tray icon is placeholder artwork.** No app icon of any kind existed
  anywhere in this repo before this feature — `resources/tray/`'s PNGs
  are a hand-generated simplified "stack" glyph
  (`scripts/generate-tray-icon.mjs`, a one-time, non-build-pipeline
  script; no image library dependency added for a throwaway asset),
  correctly built as real macOS "template images" (monochrome,
  `Template`-suffixed filenames, so the OS still auto-inverts them
  correctly for light/dark menu bars) but not the app's real visual
  identity. Real artwork is a follow-up, not scoped here.
- **A pre-existing, newly-reachable race in the VS Code terminal-restore
  handoff.** `packages/shared/src/vscode-restore.ts` keys its pending-
  restore file by a hash of the folder path, not by workspace id. Two
  different workspaces whose `vscode` step points at the same folder,
  with hotkeys fired close together, could have their handoff files
  overwrite each other — last writer wins, silently. This flaw already
  existed; the hotkey feature is what makes two *different* workspaces
  plausibly fire within the same few hundred milliseconds (today's UI
  is one-workspace-at-a-time). Not fixed here — it's a separate design
  problem in the handoff file's own keying scheme.
- **Windows/Linux**: the Shift-variant's Switch semantics degrade to a
  plain Restore on any platform but macOS (mirrors the existing
  `SUPPORTS_WORKSPACE_ACTIVITY` gate — there's no Windows equivalent of
  the close/liveness primitives yet), same as the in-app Switch button
  already does. Harmless, not specially gated — consistent, not broken.

## New files

- `packages/shared/src/accelerator.ts` — `isWellFormedAccelerator`,
  `SWITCH_MODIFIER`, `switchAccelerator`. Shared between main (defense-
  in-depth re-validation — a binding could in principle reach
  `syncHotkeys()` from a hand-edited `workspace-hotkeys` electron-store
  JSON file, not just the trusted in-app recorder) and renderer (the
  recorder's own fast local check).
- `apps/desktop/src/main/orchestrator/workspace-hotkeys-store.ts` —
  `Record<workspaceId, baseAccelerator>`, mirrors
  `workspace-activity-store.ts`'s exact electron-store shape.
- `apps/desktop/src/main/orchestrator/hotkey-service.ts` — the single
  `syncHotkeys()` chokepoint (full unregister-then-reregister-from-
  bindings, never incremental), per-registration try/catch so one bad
  binding can't abort the rest, an in-flight debounce `Set` so a
  double-press can't fire an overlapping orchestrator run, and the
  failure-notification path.
- `apps/desktop/src/renderer/src/lib/workspace-hotkeys.ts` —
  `baseComboFromEvent` (built from `event.code`, layout-independent —
  deliberately NOT `event.key` like `ShortcutRow.tsx`'s own
  `comboFromEvent`, which is layout-dependent and fine for that
  renderer-only purpose but wrong for an OS-level accelerator).
- `apps/desktop/src/renderer/src/components/WorkspaceHotkeyControl.tsx`
  — the current (post-relocation) UI: a compact pill living inline in
  `Detail.tsx`, self-fetching its own binding/needs-repick state rather
  than being handed it, with the same recording-state-machine shape
  (idle/recording/saving/error, a client-side timeout) its removed
  predecessor (`WorkspaceHotkeyRow.tsx`, a Settings-list row — deleted,
  see "Revised after real usage" above) had.
- `apps/desktop/scripts/generate-tray-icon.mjs`,
  `apps/desktop/resources/tray/trayIconTemplate{,@2x}.png` — see "Known
  limitations" above.

## Modified files

- `apps/desktop/src/main/ipc/handlers.ts` — `restoreWorkspaceWithFocus`
  extracted from the `workspaces:restore` IPC handler's own inline
  focus/progress wiring, so the hotkey-triggered Restore path gets the
  identical always-on-top-pin + live-progress experience a window-open
  click would, instead of a silently degraded one when a window
  happens to be open. New `setWorkspaceHotkey`/`clearWorkspaceHotkey`/
  `getWorkspaceHotkey`/`getAllWorkspaceHotkeys`/`getFailedWorkspaceHotkeys`/
  `getLaunchOnLogin`/`setLaunchOnLogin`. `deleteWorkspace` now also
  clears any hotkey bound to the deleted workspace and re-syncs — an
  orphaned binding would otherwise sit in the store forever.
- `apps/desktop/src/main/index.ts` — the tray/background/quit logic
  above, all scoped inside the existing
  `if (gotSingleInstanceLock) { ... }` block (an adversarial-review
  finding: registering `before-quit` at module scope would let a
  failed-lock secondary process intercept its own already-queued
  `app.quit()` and get stuck running headless, unkillable except via
  `kill -9`).
- `apps/desktop/src/main/settings/store.ts` — new
  `hasShownBackgroundNotice: boolean` field.
- `apps/desktop/src/preload/index.ts` — the new bridge methods.
- `apps/desktop/src/renderer/src/components/SettingsModal.tsx` — a
  "Launch at login" toggle only (the "Workspace hotkeys" section that
  briefly lived here was removed — see "Revised after real usage").
- `apps/desktop/src/renderer/src/components/Detail.tsx` — renders
  `WorkspaceHotkeyControl` inline in the metadata-pill row.
- `apps/desktop/src/renderer/src/icons.tsx` — new `keyboard` glyph for
  the pill.
- `apps/desktop/electron-builder.yml` — `extraResources` entry copying
  `resources/tray/` into the packaged app's `Resources` folder.
- `packages/shared/src/types.ts`, `error-codes.ts`, `index.ts` — new
  result types (`SetHotkeyBindingResult`, `GetLaunchOnLoginResult`,
  `SetLaunchOnLoginResult`) and error codes (`ER-HOTKEY-01/02`,
  `ER-SYS-02`), `accelerator.ts` added to the barrel.

## Adversarial review findings, fixed before any code existed

A full list lives in the planning conversation, not duplicated here —
the headline ones are referenced inline above (module-scope `before-
quit` placement, the `window-all-closed` tray-quit notification gate,
`register()`'s actual boolean return value vs. the originally-assumed
`isRegistered()`-only signal, per-registration try/catch, the hotkey-
triggered-Restore focus/progress gap, and the async recording row's
Escape-blocking ref).

## Tests

- `packages/shared/src/accelerator.ts` — covered indirectly via
  `hotkey-service.test.ts`/`workspace-hotkeys.test.ts` (no dedicated
  file; it's a small, pure validator exercised by both its callers'
  own suites).
- `workspace-hotkeys-store.test.ts` — mirrors
  `workspace-activity-store.test.ts`'s electron-store mock precedent.
- `hotkey-service.test.ts` — simulated `globalShortcut` registry
  (register/unregister/unregisterAll against a real `Map`, so
  "another app owns this" can be simulated honestly), covers
  registration, partial-failure rollback, malformed/Shift-containing
  bindings being skipped, the in-flight debounce, and
  success/failure notification behavior.
- `handlers.test.ts` — new hotkey/launch-on-login handler tests
  (including the rollback-to-previous-binding behavior), the
  `deleteWorkspace` cleanup call, and updated `mockWin` fixture
  (`webContents.send`/`isDestroyed`) for the `restoreWorkspaceWithFocus`
  extraction.
- `apps/desktop/src/renderer/src/lib/workspace-hotkeys.test.ts` —
  `baseComboFromEvent`'s `event.code` mapping, modifier handling
  (including the mac-Control regression above), and
  `isValidBaseCombo`/`switchAccelerator`.
- No new renderer component tests — matches this repo's established
  precedent.

## Verification

`npm run lint && npm run typecheck && npm run test && npm run build` —
all green (676 tests passing) after each build slice (foundation →
IPC/preload/lifecycle → renderer UI), not just at the end, per this
round's own size.

No end-of-feature live Playwright pass — per the founder's standing
instruction, they test directly. Genuinely unverifiable by any unit
test and left for manual confirmation: the tray icon's actual on-screen
appearance in both menu-bar themes, a hotkey actually firing while the
app is fully backgrounded (window destroyed) or freshly launched via a
real login-item registration across an actual reboot, and whether
`before-quit`'s backgrounding behavior fights electron-vite's own
dev-mode hot-restart flow (flagged as a thing to check empirically
during that workflow, not theorized further here).
