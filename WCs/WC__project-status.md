# Project Status

Last updated: 2026-09-22. Snapshot of what's real, what's scaffolded, and
what's next — for picking the project back up after time away. This is
the single source of truth for build status; `claude.md`'s own "Current
Status" section is a short pointer here, not a duplicate — update this
file, not that one, as work continues. See also
`WCs/WC__vscode-terminal-restore.md` for that feature's full design
writeup (too substantial to keep re-summarizing here).

## Where the code actually lives

Everything below — the Windows platform layer, real workspace
persistence, full CRUD, the Add-tool picker, the Chrome/Spotify/VS Code
tool plugins, the VS Code companion extension's terminal-restore feature,
and three rounds of multi-agent review-and-fix passes — has just been
committed and pushed to `main` (previously sat uncommitted since
`25dc0ff` across two work sessions).

## Platform roadmap

Windows v1 → Linux → macOS (see `claude.md`'s own roadmap note for why).
Windows testing is currently blocked on VM access (no Windows machine/VM
set up yet), so feature work has temporarily resumed on the macOS-track
app in the meantime — this hasn't been wasted, since almost everything
built since the reorder (persistence, CRUD, the tool plugins, the VS Code
extension, the Add-tool picker) is platform-agnostic and works
identically once Windows becomes primary again.

## What's real (built, wired, tested)

- **App launches**: Electron + React renderer, single-instance lock,
  native app menu, frameless window with correctly positioned real
  traffic lights, enforced 1200×700 minimum size.
- **Platform launchers, both real**: `platform/macos/launcher.ts` (real
  `open -a` calls) and `platform/windows/launcher.ts` (resolves known
  apps to their real `.exe` via `windows/app-paths.ts`, deliberately
  avoids `cmd.exe`/`.cmd` shims — see that file's own doc comment for
  why). Both argv-array/`shell:false` throughout (command-injection-safe),
  both unit-tested; real end-to-end manual verification on Windows is
  still pending the VM.
- **Three real tool plugins**, all following the same `validate`/`run`/
  `teardown` template (`vscode-tool.ts`, `chrome-tool.ts`,
  `spotify-tool.ts`): VS Code opens a folder path (and can optionally
  stage a terminal restore, below); Chrome opens a profile with zero or
  more tabs (sequential opens, not concurrent, to avoid the OS treating
  rapid launches as separate windows); Spotify opens a real
  `spotify:`/`open.spotify.com` link or just launches the app.
- **Manually verified end-to-end on macOS, for real, in the actual app**
  (not just unit tests): a real workspace config, real VS Code install,
  real Chrome install — restoring it opened VS Code with a Panel
  terminal running `npm run dev`, then opened Chrome. This is what
  caught the Chrome `-n` bug below; nothing else would have.
- **VS Code companion extension — terminal restore, real and working**:
  a VS Code step can carry one terminal's worth of commands (schema
  supports N; the v1 UI surfaces one, mirroring Chrome's `urls` textarea
  pattern). On restore, `vscode-tool.ts` stages a small versioned,
  TTL-expiring handoff file (`packages/shared/src/vscode-restore.ts`,
  keyed by a hash of the canonicalized folder path — normalized for
  Windows' case-insensitivity _and_ separator style, so a user-typed
  forward-slash path and VS Code's own backslashed `fsPath` resolve to
  the same file) before opening VS Code. The extension
  (`apps/vscode-extension/src/extension.ts`) picks it up on cold start
  (`onStartupFinished`), on window refocus, or via a manual "Restore
  Terminals" command — covering the one gap the automatic triggers can't
  (already-open-and-already-focused) — creates a Panel terminal per
  entry, waits for shell-integration readiness (avoiding VS Code's
  documented first-command-drop race), runs the commands, then deletes
  the handoff file. Failure paths (a corrupt file, an unsupported
  version, `createTerminal()` throwing, the cleanup delete itself
  failing) all warn the user rather than failing silently or
  double-firing.
- **Orchestrator wired end-to-end**: "Restore workspace" really calls
  through IPC → orchestrator → tool → platform → shell, real per-step
  results shown in the UI. A timing-history write failure can no longer
  turn a genuinely successful step into a reported failure, and the
  adaptive timeout now has a floor so a consistently-fast tool can't
  converge on a false-triggering few-millisecond timeout (both fixed
  this round, see below).
- **Design system**: Tailwind v4 + shadcn, with a second Radix primitive
  — `components/ui/dropdown-menu.tsx` (backs the Edit/Delete kebab menus
  and the Add-tool picker), alongside the original `Dialog`.
- **Real workspace persistence, fully wired**: "New workspace" → Save
  actually writes a config (`config/loader.ts`'s `saveWorkspaceConfig`)
  that `workspaces:list`/`workspaces:restore` read back.
- **Full CRUD**: Edit and Delete are real, via kebab menus in the
  sidebar and the detail header (Radix `DropdownMenu`). Mock demo
  workspaces are correctly read-only (no kebab at all — `readOnly: true`,
  can't be edited/deleted, both client- and server-side enforced), and
  now correctly lose to a same-id real config if one is ever hand-placed
  or imported (fixed this round).
- **Real "Add tool" picker**: a dropdown listing all 6 Tier-1 step
  types (icon, name, hint), a "Soon" badge for the 3 still-unbuilt types
  (Docker, Terminal, Slack) without blocking you from adding one anyway,
  picking a type with a real param field auto-focuses it. A new
  workspace's two default rows are now seeded by explicit type (VS Code
  and Chrome, both implemented) rather than by array position — a
  positional pick previously seeded every new workspace with a silently
  non-functional Docker row (fixed this round).
- **`packages/shared/src/step-types.ts`** is the single source of truth
  for tool metadata (icon/color/name/hint/implemented) — both the
  renderer's `constants.ts` and the main process's
  `config/workspace-display.ts` derive from it; confirmed no second
  hand-maintained copy exists anywhere.

## What's still fake / not wired

- **Docker, Terminal, and Slack** still correctly report "no registered
  tool" on restore — honest, not faked; same pattern the other three
  followed before they were built. ("Terminal" here means a standalone
  step type with its own pane(s); the VS Code step's own narrower
  terminal-restore feature above is a different, already-built thing.)
- Search bar, Settings button — still decorative only.
- **Real end-to-end Windows verification** — blocked on VM access (see
  Platform roadmap above); the Windows launcher itself is built and
  unit-tested, just not yet run for real on a real Windows machine.

## Review round 1-2's fixes (2026-09-18)

Six review passes ran across two rounds — round 1: `code-review`,
`security-review`, an architecture/edge-case review (7 bugs found and
fixed); round 2 (re-reviewing the round-1 fixes themselves): a fresh
`code-review`, a dedicated fix-verification pass, an end-to-end
functional-correctness trace (4 more bugs found and fixed). **11 real,
concrete bugs** total, all independently re-verified and covered by new
regression tests:

- Windows path-separator hash mismatch that could silently break the
  entire terminal-restore feature on the v1 target platform.
- A failed cleanup delete after a successful restore could silently
  re-run every restored command a second time on the next focus.
- Version-mismatched/malformed restore files could never be swept even
  once expired, accumulating on disk forever.
- A staged restore file wasn't cleaned up when the VS Code launch itself
  failed, so a later manual open could still silently fire it.
- `PRODUCT_NAME` was hardcoded in two places instead of one shared
  constant, risking future silent drift between the app and extension.
- A synchronous timing-history write failure could turn a genuinely
  successful step into a reported failure.
- The adaptive step timeout had no floor, risking false-timeout failures
  on a consistently-fast tool from ordinary scheduling jitter.
- New-workspace defaults silently seeded a non-functional Docker row
  (positional preset pick, not by type).
- Editing the VS Code terminal-commands field silently dropped any
  terminal entries beyond the first.
- `createTerminal()` throwing inside the extension was an unhandled,
  silent failure with zero user feedback.
- `listWorkspaces()` had no defense against a real config colliding with
  a hardcoded mock id (not reachable via the UI today, but a real gap
  for a hand-placed/imported config file).

A 12th real bug was found separately, via live manual testing rather
than a review pass: `platform/macos/launcher.ts`'s
`openUrlInBrowserProfile` used `open -a "Google Chrome" --args
--profile-directory=<profile> <url>` — this silently drops `--args`
entirely (both the profile selection and the URL) whenever Chrome is
already running, which is the common case, not an edge case. Confirmed
live: the same command with no changes did nothing with Chrome already
open; adding `-n` (forces `open` to spawn a genuinely new process every
time, not just activate the existing one) fixed it immediately. Windows'
equivalent (`windows/launcher.ts`) doesn't have this bug — it spawns
`chrome.exe` directly via `runDetached`, which relies on Chrome's own
already-running-instance IPC instead of macOS's `open -a` activation
semantics.

**Security review came back clean** — the 3 candidate findings raised
(an unauthenticated restore-handoff file, a Chromium argv-switch
injection via `urls`, a VS Code CLI-flag injection via `path`) were all
independently fact-checked and rejected: this is a single-user local
tool with no config import/export/sharing feature anywhere, so none of
them cross a real trust boundary today. Worth revisiting if a
config-sharing feature is ever added.

One flagged "violation" was a false alarm both times it came up: the
macOS `launcher.ts` work is the founder's own explicitly authorized
interim filler work (claude.md's 2026-09-17 note) while Windows VM
access is unresolved, not scope creep.

## Review round 3's fixes (2026-09-22)

Real manual testing in the actual running app (see "What's real" above)
found one bug live: `platform/macos/launcher.ts`'s
`openUrlInBrowserProfile` used `open -a "Google Chrome" --args
--profile-directory=<profile> <url>`, which silently drops `--args`
entirely whenever Chrome is already running — the common case, not an
edge case. Confirmed live (the same command did nothing with Chrome
already open; adding `-n`, which forces a genuinely new process every
time, fixed it immediately) before touching any code.

That prompted a third full review round (6 passes: `code-review`,
`security-review`, an architecture/edge-case review, a docs-accuracy
review, a test-coverage audit, plus a second `code-review` after the
first round of fixes) against the complete diff. Real, concrete findings
fixed:

- **Two stale-async-close races**: `WorkspaceFormModal.tsx` and
  `DeleteWorkspaceConfirm.tsx` let their Cancel/X/Escape/overlay-click
  close paths fire while a save/delete was still in flight. Cancel a
  save on workspace A, immediately open Edit on workspace B, and A's
  stale save could resolve afterward and silently clobber B's
  in-progress edit (same shape for delete). Fixed by blocking every
  close path while the operation is in flight, plus (delete only)
  checking the deleted id actually matches what's currently showing
  before clearing it.
- **Windows would have shown double window chrome** — `main/index.ts`'s
  `titleBarStyle`/`trafficLightPosition` are macOS-only options Electron
  silently _ignores_ elsewhere, so the custom-drawn title bar would have
  gotten a second, real native Windows title bar on top of it (the same
  bug class already fixed for macOS once, unaddressed for the v1 target
  platform). Fixed with `titleBarStyle: 'hidden'` + a themed
  `titleBarOverlay` on non-darwin (Electron's supported cross-platform
  equivalent, keeps real OS minimize/maximize/close buttons rather than
  removing them with no replacement). The renderer now reads
  `window.api.platform` (new preload field) to reserve title-bar space
  on the correct side per platform. **Implemented but UNVERIFIED** — no
  Windows/Linux machine to look at it on; see `App.tsx`/`main/index.ts`'s
  own comments and "Natural next steps" below.
- **A relative `vscode` step `path` silently broke terminal restore**:
  `VSCodeStepParamsSchema` only required a non-empty string, so a path
  like `my-project` (no `~`, not absolute) would hash to a different
  file than the extension's absolute `folder.uri.fsPath` ever would —
  restore staged, never consumed, no error anywhere. Fixed:
  `lib/paths.ts`'s new `isAcceptableToolPath` rejects anything that
  isn't absolute or `~`-prefixed, with a clear validation message.
- **A keyboard accessibility bug in the sidebar**: a workspace row's
  `onKeyDown` fired `onSelect` on Enter/Space with no guard, so
  Tab-ing to the row's "..." kebab button and pressing Enter to open its
  menu also switched the selected workspace as an unwanted side effect
  (the kebab's `onClick` already guarded against the mouse-click
  equivalent; `onKeyDown` didn't). Fixed with the same
  `stopPropagation()` on the kebab's `onKeyDown`.
- **Add-tool picker could break Tab order** for an unimplemented type
  (Docker/Terminal/Slack, selectable but with no input field) — focus
  fell through to `<body>` instead of anywhere visible. Fixed:
  Radix's default refocus-to-trigger is only suppressed when the picked
  type actually has an input to hand focus to instead.

Two more real findings were **documented rather than "fixed"**, since a
real fix would mean guessing at unverifiable behavior:

- `windows/launcher.ts`'s already-running-app assumption (Chrome/VS
  Code/Spotify's own singleton IPC honoring argv on a second launch) —
  architecturally sound reasoning, but the equivalent macOS assumption
  just turned out to be wrong and needed a real fix, so this is flagged,
  not assumed safe. First thing to verify once a Windows VM exists (see
  "Natural next steps").
- `chrome-tool.ts`'s sequential multi-tab opens could theoretically race
  Chrome's singleton registration on a genuinely cold start (Chrome not
  already running) — testing this for real means quitting a real
  running Chrome to force a cold start, which isn't something to do
  without asking first. Left as commented, not "fixed" with an unproven
  timing guess.
- `spotify-tool.ts`'s Windows playlist-URI handling (bare positional
  argv vs. the OS's `spotify:` protocol handler) was already a real,
  pre-existing unverified risk — given a clearer in-code comment this
  round, not newly discovered.

Also this round: `apps/desktop/src/main/config/workspace-display.ts`'s
`description` field (the `joinWithAnd` helper) had zero test coverage —
added. Two pieces of pure logic living inside React components with no
regression coverage were extracted into
`apps/desktop/src/renderer/src/lib/` (`vscode-terminal-params.ts`,
`workspace-selection.ts`) and fully tested, following this project's
existing precedent (`vscode-restore.ts`, `write-file-atomic.ts`) of
pulling pure logic out specifically to make it testable outside its host
runtime. New WC doc: `WCs/WC__vscode-terminal-restore.md`, the full
design writeup for the terminal-restore feature (handoff mechanism,
versioning/TTL, activation triggers, all failure paths, known
limitations, manual test plan) — too substantial to keep re-summarizing
in this file.

## Known issues, not yet fixed (deliberately deferred — architecture/DRY, no live bug)

- `orchestrator.ts` passes each tool's _raw_ `step.params` to `run()`,
  not `validate()`'s parsed/defaulted zod output — every tool with an
  optional/defaulted field (chrome's `urls`, vscode's `terminals`) has
  to independently re-derive the same default at the top of `run()`. A
  future tool that forgets the same `Array.isArray(...) ? ... : []`
  guard will crash on old configs that still pass `validate()`.
- `ipc/handlers.ts`'s `restoreWorkspace`/`updateWorkspace`/
  `deleteWorkspace`/`listWorkspaces` each independently load and fully
  parse every saved config just to find or check one id — an O(n) scan
  where `<id>.json` keying would allow O(1). A deliberate
  correctness-over-performance tradeoff so far, fine at realistic
  workspace counts.
- The identical zod-`safeParse`-to-`ValidationResult` adapter is
  copy-pasted across `vscode-tool.ts`, `chrome-tool.ts`, and
  `spotify-tool.ts` instead of one shared helper.
- The per-workspace Actions dropdown (Edit + Delete) is duplicated
  verbatim between `Sidebar.tsx` and `Detail.tsx`.
- `handlers.ts`'s `validateStepsWithRegisteredTools` and
  `orchestrator.ts`'s `runStep` build the identical
  `Invalid params for step type "X": ...` error string independently.
- `platform/macos/launcher.ts` and `platform/windows/launcher.ts` build
  near-identical success/failure message strings independently — will
  triple when Linux is added next per the roadmap.
- `workspace-display.ts`'s `detailForStep`/`expandForStep` and
  `WorkspaceFormModal.tsx`'s `StepParamsFields` each hand-branch on
  step type in three separate files instead of a lookup table keyed off
  the tool registry — flagged again this round as "the right moment is
  before a 4th tool type ships," which is still true (still 3/6 built).
- Multi-root VS Code workspaces / Remote-WSL-SSH-Dev-Container gaps —
  now documented in full in `WCs/WC__vscode-terminal-restore.md`'s
  "Known, documented limitations" section rather than summarized here.

## Known, deliberately deferred issue

`apps/desktop` has no plain `tsconfig.json` (only `tsconfig.node.json` +
`tsconfig.web.json`), so VS Code's editor can't discover which config
applies to renderer files. Shows as false-positive red errors in the
editor — the _real_ `npm run typecheck` has been clean every time
regardless. Fix proposed once, declined once; still open, no urgency.

## Verified state as of the last real check

Lint / typecheck (4 workspaces) / test (**214/214**) / build (main,
preload, renderer, vscode-extension) / format all clean. Three full
multi-agent review rounds have now run against this codebase (round 1-2:
2026-09-18, round 3: 2026-09-22 — 12+ review-agent passes total across
all three) plus real manual end-to-end testing in the actual running
app. Every real, concrete bug found across all three rounds has been
fixed with a regression test; every unverified-and-can't-verify-without-
disrupting-something risk (Windows already-running-app behavior, the
Chrome cold-start multi-tab race, the Windows titlebar overlay, Spotify's
Windows URI handling) is explicitly flagged in the code and here, not
silently assumed fine.

## Natural next steps, in order of what unlocks the most

1. **Set up a Windows VM/machine** — unblocks real end-to-end
   verification and lets Windows resume as the primary track. First
   things to check once it's unblocked, in order:
   1. The VS Code extension's Windows-specific path-canonicalization
      behavior (fixed round 1-2, never yet run against a real Windows
      filesystem).
   2. `windows/launcher.ts`'s already-running-app assumption — restore a
      workspace with Chrome/VS Code already open and confirm the right
      profile/folder/URL actually opens, not just that the app launches.
      macOS needed a real fix (`-n`) for exactly this class of bug,
      invisible to mocked unit tests and only caught by live manual
      testing — Windows' mechanism is architecturally different and
      _should_ be fine, but that's an unverified assumption (see the
      comment at the top of `windows/launcher.ts`).
   3. The `titleBarStyle: 'hidden'` + `titleBarOverlay` Windows/Linux
      title bar fix (round 3) — implemented from theme values and
      Electron's documented API, never visually confirmed.
2. **The next tool plugin** — Docker, Terminal, or Slack, following the
   now-three-times-proven `vscode-tool.ts`/`chrome-tool.ts`/
   `spotify-tool.ts` pattern. Worth restructuring `WorkspaceFormModal.tsx`'s
   `StepParamsFields` and `workspace-display.ts`'s `detailForStep` from
   per-type `if` branches into a lookup table _before_ the 4th type
   lands — flagged by multiple review passes now as the right moment,
   not premature.
3. Everything in `claude.md`'s "ship-readiness" list (code signing,
   licensing, auto-update, crash reporting) — explicitly deferred until
   there's something real to actually ship.
