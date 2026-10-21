# Project Status

Last updated: 2026-10-20. Snapshot of what's real, what's scaffolded, and
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
  sidebar and the detail header (Radix `DropdownMenu`), for every
  workspace. The bundled demo/mock workspace feature (and its
  `readOnly` concept) has been removed entirely — see "What's shipped
  since 2026-09-22" below.
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
- ~~Search bar, Settings button — still decorative only.~~ Both real now
  — see "What's shipped since 2026-09-22" below.
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

## What's shipped since 2026-09-22

Several rounds of real feature work, not just fixes. Each has its own WC
doc for full depth — this section is a pointer, not a re-summary,
matching the precedent `WC__vscode-terminal-restore.md` already set.

- **Config UX pickers** (the Tier 1 "no manual typing" item, build-shell.md):
  VS Code project path via native folder dialog + Recent list, Chrome
  profile via real on-disk enumeration, Spotify playlist via a real
  OAuth connection + picker. All three real, no free-text fields left for
  any of them.
- **Light theme** support alongside the original dark theme.
- **A full, user-customizable keyboard shortcut system** — not just a
  Cmd+K wire-up. Real search (live-filters the sidebar), a Settings page
  (the gear icon was decorative until now), per-shortcut rebinding with
  conflict/reserved-combo blocking, `localStorage` persistence. See
  `WCs/WC__keyboard-shortcuts.md`.
- **Inline quick-edit from the Detail view** — expanding a step shows the
  same real editing UI the "Edit workspace" modal uses, no need to leave
  Detail to change a step's params. See `WCs/WC__quick-edit.md`.
- **Retry per failed step** (the Tier 1 checklist item, build-shell.md) —
  a failed step can be re-run individually after a restore, without
  re-running the whole workspace. See `WCs/WC__retry-per-step.md`.
- **A generic "App" step type** — not hardcoded to one app like
  vscode/chrome/spotify/clockify; picks any installed macOS app via a
  native dialog and launches it, with that app's own real icon and name
  shown (not a generic placeholder). The actual unlock for non-dev
  personas (office/design) to use this tool without a hand-written
  `*-tool.ts` per app. Real debugging saga behind the icon rendering —
  worth reading in full if this area breaks again. See
  `WCs/WC__app-launcher.md`.
- **Netflix-style error codes + a searchable Errors page.** Every
  surfaced failure (restore step, Chrome/Spotify error, workspace save
  error) now shows a stable `ER-<CATEGORY>-<NN>` code with a "Learn more
  about this error" link into a dedicated catalog — reachable only via
  that link, not Settings/Sidebar. See `WCs/WC__error-codes.md`.
- **Restore / Switch / Close workspace activity tracking** (Tier 2
  "Teardown," consciously pulled forward — `docs/build-shell.md`). Two
  new actions beyond the existing (unchanged) Restore: "Switch to this
  workspace" reconciles everything currently running to match just one
  target; "Close this workspace" drops only its own apps. No PID
  tracking anywhere — name-based AppleScript liveness/quit, intent +
  liveness drives the sidebar's "Active" badge. Chrome excluded from
  auto-close; VS Code's liveness is app-level, not per-window — both
  flagged, not solved. macOS only, v1. See
  `WCs/WC__workspace-activity.md`.
- **Removed the bundled demo/mock workspace feature entirely.** Root
  cause: it was the direct cause of a live bug the founder hit right
  after the activity-tracking round above — a never-restored mock
  workspace's `vscode` step matched the founder's own real, unrelated
  VS Code window, and Switch closed it. That specific bug was already
  fixed via candidate-scoping (only an app belonging to another
  workspace that is itself currently active is ever eligible to be
  closed), but the founder asked for the demo data gone outright so
  this whole class of surprise can't recur. Deleted
  `mock-workspaces.ts` and all its wiring in `handlers.ts`
  (`resolveWorkspaceConfig`, `listWorkspaces`, the edit/delete
  read-only guards); removed the now-dead `readOnly` field from
  `WorkspaceDisplay` and every UI branch on it (`Sidebar.tsx`,
  `Detail.tsx`, `TimelineStep.tsx`); removed the now-dead
  `WORKSPACE_READONLY` error code. The app now only ever shows
  workspaces the user actually created.
- **Real launch-time display**, replacing the old hardcoded `'0s'`/`'—'`
  placeholders. Went through a full `/judge` round (parallel research +
  an adversarial plan review) after the founder flagged the numbers as
  fake and asked why a Proton launch (process-exists ~3s, visually idle
  ~6s) showed nothing real. Deliberately scoped to "launch," never
  "restore"/"ready" — true app-idle detection would need a new macOS
  Accessibility/TCC permission or a native helper binary, both of which
  would directly contradict this project's own prior decision to defer
  that exact complexity class (see "Platform roadmap" above). What
  shipped: on macOS, after a GUI-launch step (vscode/chrome/spotify/
  clockify/app) succeeds, a detached, un-awaited poll (`process-control.ts`'s
  `waitForAppRunning`, bounded at 2 minutes) checks for the app actually
  coming up and records the improved duration into the existing
  `step-timing-history.ts` store — detached specifically so a
  slow-to-launch app never slows down the restore itself (Windows is
  unaffected either way). The UI (`TimingDisplay`, a typed
  `{ display, state }` shape replacing the old sentinel-string checks)
  shows "Not yet measured" below 3 samples, an approximate "~Xs" once
  there's enough history, and an honest partial total
  ("~8s · 2/3 steps timed") when only some of a workspace's steps have
  data yet. Known, deliberately accepted limitation: the generic 'app'
  step type's history bucket is still shared across every distinct app
  using it (keyed by bare step type, same as the existing adaptive-
  timeout feature) — re-keying it per-app was considered and explicitly
  not done, since it would silently break that existing timeout
  feature's own lookups without separate dedicated review.
- **Real app-location detection** for the 4 built-in tools (VS Code,
  Chrome, Spotify, Clockify) — the last open Tier-1 "no manual typing"
  must-have. Went through a full `/judge` round, driven by the
  founder's hard constraint: "it must work for any user therefore no
  hardcodings" — ruling out even a single hardcoded bundle ID per tool
  (would miss VS Code Insiders, VSCodium, Chrome Beta/Canary, etc.).
  Shipped design: on macOS, scans `/Applications`/`/System/Applications`/
  `~/Applications` for a bundle whose own directory name matches a
  tool's product-family name (`platform/app-detection.ts`) — empirically
  verified live during planning that `CFBundleDisplayName` alone is
  insufficient (VS Code's real install reports `"Code"` there, not
  `"Visual Studio Code"`), so the directory name is the primary signal,
  `CFBundleDisplayName` only a secondary one. Never silently picks a
  winner: the Add-tool/Edit UI (`ResolvedAppPath.tsx`, shared across all
  4 tool field components, including a new `clockify-fields.tsx` —
  Clockify previously had no fields component at all) always shows the
  resolved path with a "Not this one? Pick manually" link, falls back to
  the existing native app-picker on zero matches, and shows a
  disambiguation list (reusing the Chrome-profile-picker's exact
  dropdown pattern) on multiple matches. A chosen/overridden path is
  just a new optional `appPath` step param, persisted only through the
  existing explicit Save flow — never written back by an unattended
  restore. A machine-level scan cache (`app-detection-cache.ts`, 24h TTL,
  same `electron-store` pattern as `step-timing-history.ts`) means a
  restore of an old config with no stored `appPath` never re-scans
  `/Applications` every single run. A stale stored path fails loudly at
  launch time ("not found — may have moved or been uninstalled"), never
  silently falls back to a blind name guess. Zero new macOS permissions
  — same plain shell-out pattern (`plutil`, `runCommand`) already used
  for the icon-extraction feature, no Accessibility/TCC surface
  reopened. An adversarial review pass caught and fixed 6 real issues
  before/during build: a dual-cache redundant-rescan risk (fixed by
  keying the renderer's detection cache by tool type, not row — two VS
  Code steps in one workspace now share one scan), a missing
  `clockify-tool.ts` `run()` signature change, a real import-layering
  violation (the four product-family name constants moved to
  `packages/shared` so neither `tools/` nor `platform/` imports from the
  other), a missing platform guard (macOS-only, resolves to an empty
  candidate list elsewhere rather than attempting the scan), and the 4
  existing tool unit tests which would have started shelling out for
  real and failing on whichever machine actually has these apps
  installed (fixed by mocking the new resolver). 564/564 tests, lint/
  typecheck/build all clean.
  - A second, 4-agent review pass ran against the actual built code
    (not the plan) from four angles: correctness/async, security,
    renderer/UX, test coverage. Security and correctness came back
    clean (one theoretical, low-stakes concurrent-rescan note, not
    worth fixing). Real fixes applied: inconsistent "Pick"/"Choose"
    vocabulary across `ResolvedAppPath.tsx`'s states, standardized on
    "Choose"; a `validate()` round-trip test for the new `appPath`
    field added to all 4 tool test files; and the renderer's detection-
    dedupe logic (previously verified only by code review, zero test
    backing) extracted into a pure `detection-deduper.ts` so its actual
    "only one real IPC call per tool type" guarantee has a real test —
    this project has no React hook/component-testing setup, so the
    fix was extracting the testable logic, not adding a new test
    framework. 574/574 tests, lint/typecheck/build all clean.

## Review round: today's full batch (2026-10-20)

8 review agents ran against every change in this session's batch (mock
removal: 2 agents; the Active-badge focus-refresh fix: 1; the
`lastRestored` removal: 1; the launch-time feature: 4, covering
async/race correctness, security, UX wording, and test coverage). Real
issues found and fixed:

- The focus-refresh fix (window regains focus → re-check workspace
  activity) was firing on every single restore step, not just when the
  user actually tabbed back in — `restore-focus.ts` reasserts window
  focus per step, which re-triggered the listener each time, contending
  with the restore's own `osascript` shell-outs. Fixed with a 2s
  debounce in `App.tsx`.
- The `lastRestored` removal missed a sibling instance of the exact same
  "fake honesty placeholder" pattern: `workspace-display.ts`'s subtitle
  unconditionally said "· never restored" regardless of real restore
  history. Removed.
- Two stale comments in `orchestrator.ts`/`TimelineStep.tsx` still
  referenced the now-deleted mock-workspace feature.
- Launch-time UX copy leaked "restore" wording in two tooltips (should
  only ever say "launch"); the workspace-level pill appended "to launch"
  for the zero-steps case, contradicting its own tooltip ("nothing to
  time"); the per-step badge was missing the "to launch" suffix the
  workspace-level pill has, so the same `full` state read inconsistently
  between the two. All fixed — added a `stepLaunchTimeLabel` helper
  mirroring the workspace-level one.
- Added 2 tests the coverage review flagged as real, cheap gaps worth
  closing: the generic `'app'` type's shared-history-bucket limitation
  (documents the known behavior rather than papering over it), and a
  workspace with two steps of the same type (proves the total sums each
  occurrence, not once per distinct type).

Explicitly **not** fixed, flagged as optional by the reviewers
themselves, not acted on without a separate decision: no dedup across
concurrent same-app-name pollers within one restore (security review,
Low severity); a rapid-retry-while-still-polling double-sample
nuisance (async review, measurement-skew only, not a correctness bug);
a deeper integration test exercising the detached record path's real
store round-trip rather than a mocked one (test-coverage review,
Medium/optional).

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

## Real bug fixed + global React error boundary added (2026-10-20)

Live bug report right after the app-location-detection feature
shipped: clicking a VS Code (or chrome/spotify/clockify) step in the
workspace Detail view's inline "quick-edit" timeline hard-crashed to a
black screen ("Cannot read properties of undefined (reading 'state')").
Root cause found: `TimelineStep.tsx` is a *second*, separate render
site for the per-tool fields components — the inline quick-edit
feature from an earlier round, distinct from `WorkspaceFormModal.tsx`'s
"Edit workspace" dialog — and it was missed when the app-location
detection feature was built. It rendered `VscodeFields`/`ChromeFields`/
`SpotifyFields`/`ClockifyFields` directly without ever passing
`appPathDetection`, so each one's `detection={appPathDetection!}` non-
null assertion handed `ResolvedAppPath` a real `undefined`. Initial live
Playwright reproduction attempts missed this because they only drove
the Edit-workspace modal path, never this inline timeline quick-edit
UI, which only the founder's own manual testing actually exercised.
Fixed by lifting a `useAppPathDetections()` instance into `Detail.tsx`
(same pattern as `WorkspaceFormModal.tsx`, no reset-on-close needed
here since a detection stays valid for the whole session regardless of
which workspace's Detail view is open) and threading it through
`TimelineStep.tsx`'s new optional `appPathDetection` prop into `Fields`,
gated by `isToolAppKey(tool.type)`.

Real, separate gap this also surfaced: this renderer had **zero React
error boundaries anywhere** — any uncaught render exception, from this
bug or any future one, took down the whole window with nothing to
catch it. Fixed with a new top-level `ErrorBoundary.tsx`
(`apps/desktop/src/renderer/src/components/`), a standard
`getDerivedStateFromError`/`componentDidCatch` class component (the
only valid shape — no hook equivalent exists), wrapping `<App />` in
`main.tsx`. Shows "Something went wrong" + the error message + a
Reload button instead of a black screen; still logs to the console, so
nothing is hidden, just no longer fatal to the whole app. Deliberately
one boundary at the top, not one per row/modal — the goal is "the app
can never go fully black again," not full per-row recovery — and it's
what made this exact crash safely diagnosable instead of a silent dead
window. Kept as a permanent safety net even with the real bug now
fixed, directly satisfying claude.md's "no unhandled failure paths...
fails loudly, never silently" standard for this whole failure class.

## Detection scan switched from fixed folders to Spotlight (2026-10-20)

Founder caught a real inconsistency while testing: Clockify showed
"Couldn't find Clockify automatically" in the app-location detection
UI, yet Restore still launched it correctly. Root cause: the detection
scan only walked `/Applications`, `/System/Applications`, and
`~/Applications`; the founder's real `Clockify Desktop.app` was sitting
in `~/Downloads` (never dragged into Applications) — launch still
worked because `resolveAppLaunchTarget`'s plain-name fallback shells
out to `open -a "<name>"`, which resolves via Launch Services, a much
broader system-wide lookup than the 3-folder scan.

Fixed by replacing the directory walk in
`apps/desktop/src/main/platform/app-detection.ts` with `mdfind`
(Spotlight) queries — one per tool, `kMDItemContentType ==
'com.apple.application-bundle' && kMDItemDisplayName == '*<name>*'c` —
confirmed empirically on the real machine first (same precedent as the
original CFBundleDisplayName finding): `kMDItemDisplayName` is
filename-derived, matching `appDisplayName(path)` exactly, and found
the real Clockify/Spotify/Chrome/VS Code installs including the
Downloads one. This is the same index Launch Services itself draws
from, so detection and launch can no longer disagree. Also surfaced a
genuine (and already-handled) edge case live: a real "Install
Spotify.app" installer stub sitting next to the real "Spotify.app" both
match and both surface — exactly the "always return the full candidate
list, let the user disambiguate" design already built for this,
working as intended. `plutil`/`CFBundlePackageType`-based filtering is
gone (mdfind's own `com.apple.application-bundle` UTI filter already
guarantees a real bundle); the per-tool product-family substring match
is unchanged. Rewrote `app-detection.test.ts` for the new mdfind-based
shape (573/574, net -1 test — fewer directory-walk edge cases to cover
now that there's no directory walk).

## Terminal step type (2026-10-21)

The first non-"GUI app launch" step type: open one or more real macOS
terminal windows, each `cd`'d into its own directory, each running its
own ordered list of commands — directly chosen as the highest-impact
next build, since the project's own pitch doc leads with "Docker's up,
Tilt's running" and "The Wedge" names dev-service-orchestration as the
actual differentiator, none of which existed yet. Went through a full,
proper `/judge` round (founder's own request — "proper skill use with
proper effort") rather than an abbreviated one: 4 parallel Stage-1
research agents (user-comfort/prior-art, engineering/security,
codebase-fit, edge-case), then a Stage-2 adversarial review of the
concrete plan that found and fixed 5 real issues before any of it
shipped.

Config shape: `terminals: [{ cwd, commands: string[] }]` per step —
confirmed against real prior art (tmuxinator, Warp, VS Code's own
`tasks.json`) as the right model, and matches this app's own existing
VS Code `terminals` array precedent, just adding the one field VS
Code's version could skip (it inherits its cwd from the project
folder; a standalone step has no such parent to inherit from).

Mechanism — deliberately **no AppleScript at all**: generates a
`.command` shell script via plain `fs.writeFile` (inert bytes, zero
interpretation at construction time — the real fix for the two-layer
AppleScript-string-escaping problem that `do script` would have
introduced) and hands it to `open -a Terminal` via the same
argv-only, `shell:false` `runCommand` helper every other platform
method already uses. Side effect of this choice: no macOS Automation/
TCC permission prompt is ever triggered (`open` is a Launch Services
request, not an Apple Event) — a whole category of permission-denial
handling just doesn't exist for this feature. Routed through a new
`PlatformLauncher.openTerminal()` method (macOS implemented; Windows
an honest "not implemented on this platform yet" failure, never a
silent no-op) rather than shelling out directly from `terminal-tool.ts`
— the adversarial review caught the first draft doing this and
flagged it as the one place in the whole codebase that would have
bypassed the OS-abstraction layer every other tool plugin obeys.

The review's other real findings, all fixed before shipping: a genuine
shell-injection bug in the `cd` failure's fallback line (the directory
was re-embedded into a second, differently-quoted context without
matching escaping); `open <path>` without an explicit `-a Terminal`
would have silently done the wrong thing for anyone who's ever rebound
`.command` files to a text editor; the self-deleting temp-script line
was "optional hygiene" and got made mandatory (every restore was
leaving a script behind in `$TMPDIR` otherwise); `expand()` was a bare
`() => undefined` and got a real per-terminal row (cwd + joined
commands), matching chrome-tool.ts/app-tool.ts's own precedent.

Verified three ways, not just unit tests: 38 new tests (611/611 total,
lint/typecheck/build clean) including literal assertions on the
generated script's exact content; an isolated, zero-risk live check of
the real mechanism (plain Node, no Electron, no app data touched) that
confirmed a real Terminal.app window actually opened, `cd`'d, and ran
a command; and a full real end-to-end pass through the actual app UI
(add a Terminal step, save, Restore) against one of this session's own
test workspaces, confirming "Opened 1 terminal." as a genuine success
with the command's real side effect (a marker file) actually present
afterward — cleaned up again immediately after.

**Second review round** (2026-10-21, same day): the above covered the
*plan*, reviewed before any code existed. A separate, later round — 4
agents (correctness/async, security, renderer/UX, test coverage)
against the actual *built* code — caught 4 more real issues the plan
review couldn't have, since they only existed once the code was
written:

- **Renderer bug**: `terminal-fields.tsx`'s Browse-folder flow tracked
  which terminal "card" was mid-dialog by raw array index, not by its
  stable id — if an earlier card was removed while a later card's
  native folder dialog was still open, the picked folder could land on
  whichever entry now occupied that index (a different terminal
  entirely), and the Browse button's own "busy" state would go stale
  for the card actually still browsing. Fixed: tracks the entry's
  stable id instead, re-resolving its current index only once the
  dialog actually resolves (and silently no-ops if that entry was
  removed in the meantime).
- **Renderer UX bug**: the same "two different things stacked with
  zero visual separation" class already found and fixed once this
  session (`ResolvedAppPath`'s "App"/"Project folder" labels) — a
  terminal card's directory field and its commands list had no section
  labels distinguishing them. Fixed: added "Working directory"/
  "Commands" labels, reusing `ResolvedAppPath.tsx`'s shared
  `FIELD_GROUP_LABEL_CLASS` exactly as `vscode-fields.tsx` already
  does.
- `ERROR_CODES.TERMINAL_STEP_FAILED`'s explanation text described only
  real failures (missing directory, hand-off failure), not the
  Windows-stub "not implemented on this platform yet" case that reuses
  the same code — broadened the explanation to cover both rather than
  inventing a second code for a platform that isn't the active target.
- `detail()`/`expand()`'s shared `readEntries()` let an array-shaped
  malformed `terminals` entry (e.g. a hand-edited config containing
  `[1, 2]` as one "terminal") through as a phantom terminal, since
  arrays are `typeof 'object'` too — added an explicit
  `!Array.isArray(t)` check.

Security review came back fully clean — independently re-verified the
plan-stage shell-injection fix actually landed correctly in the real
code (it has: the fix eliminates the second quoting context entirely
rather than trying to escape it, which the reviewer confirmed is the
stronger fix). 8 more tests added for real gaps the coverage review
found (not just "more tests" — each one covers a specific input that
would currently pass unnoticed if broken): the generated script's full
exact content asserted as one string instead of four independent
substring checks (catches a line-reordering regression the old
assertions couldn't); true sequential-execution proven via a
controlled-resolution-order test, not just mock call-argument order
(catches a `Promise.all` regression the old test couldn't); an
all-terminals-fail case (previously only 1-of-2 failing was tested);
the `.max(8)` cap's passing boundary (exactly 8), not just its failing
side (9); a bare `'~'` through the real schema `.refine()` wiring, not
just the underlying primitive; and a real integration test through
`handlers.ts`'s actual registry/orchestrator wiring (not just
terminal-tool.ts's own mocked unit test) — which also caught and fixed
a stale doc comment in `handlers.test.ts` still claiming terminal had
"no plugin built yet." 619/619 tests, lint/typecheck/build all clean.

## Add-tool picker: search box + a real scroll fix, terminal UX polish (2026-10-21)

Three small, founder-requested follow-ups on top of the Terminal step
work above, same day:

- **Add-tool dropdown couldn't scroll.** Founder caught this live on
  their real workspace: the dropdown (now 8 entries, grown over this
  session) had no `max-h-*`/`overflow-y-auto` at all — every other
  dropdown in the app (Chrome's profile picker, Spotify's playlist
  picker, the app-detection candidate list) already had this, this one
  just never got it. In a short window the top of the list rendered
  off-screen with no way to reach it. Fixed with the same `max-h-72
  overflow-y-auto` convention; verified live by shrinking the window to
  reproduce the original clipping and confirming a real scrollbar
  appears with every item reachable.
- **New terminal cards default to `~` (home), not a blank field** —
  matching Terminal.app's own actual default for a fresh window, not
  an arbitrary empty input. `~` was already a fully valid, tested `cwd`
  value from the earlier review round.
- **A "Recent" command picker**, reusing the exact same
  no-separate-storage pattern VS Code's existing "Recent" folder picker
  already uses — commands already saved across the user's own
  workspaces' terminal steps are the only source (new `lib/recent-
  commands.ts`, mirrors `recent-project-paths.ts` directly, +7 tests).
  Appears per terminal card, excluding whatever's already in that
  specific card's own list.
- **A live search box inside the Add-tool dropdown itself**, pinned at
  top above a scrollable filtered list, auto-focused the instant the
  dropdown opens, and wired to the app's own *currently configured*
  "focus search" shortcut (read fresh via `getEffectiveShortcuts` —
  never hardcoded to a default combo, since the founder has this
  rebound to ⌘F rather than the shipped default ⌘K). While the
  dropdown is open, that shortcut refocuses this local search box
  instead of bubbling up to the global sidebar search — via a plain
  `e.stopPropagation()` on the synthetic keydown event (which does stop
  the underlying native event from reaching `useGlobalShortcuts.ts`'s
  window-level listener), not a new cross-component signal. Two real
  implementation findings worth recording:
  - `onOpenAutoFocus` is NOT available on `DropdownMenuContent`'s
    public type — confirmed by reading `@radix-ui/react-menu`'s own
    source, not assumed: it's deliberately omitted from the public
    prop surface (`MenuRootContentTypeProps` explicitly `Omit`s every
    key of `MenuContentImplPrivateProps`, which `onOpenAutoFocus`
    belongs to). Reached for an `<input autoFocus>` instead — which
    then *also* failed, losing the focus race against Radix's own
    internal `FocusScope` (confirmed via its real source: it
    synchronously focuses the first tabbable candidate in its own
    mount effect, which — being a descendant — commits before this
    component's own effects run). Fixed with a `requestAnimationFrame`-
    deferred focus call in a `useEffect` keyed on the dropdown's own
    (now controlled, not left uncontrolled) open state — confirmed live
    via Playwright that this reliably wins the race.
  - Ordinary typing in the search box is kept from also triggering
    Radix's own built-in single-character typeahead (which would
    otherwise try to jump-select a menu item per keystroke) by
    stopping propagation on the input's own keydown for anything that
    isn't Arrow/Enter/Escape/Tab — those are deliberately let through
    so typing to filter, then pressing Down, moves naturally from
    "search" into "pick an item."
  All three live-verified via Playwright against this session's own
  isolated test profile (confirmed earlier in this round to be
  entirely separate from the founder's real app data) — autofocus
  winning the race, live filtering, and the shortcut correctly staying
  local while the dropdown is open. 626/626 tests, lint/typecheck/build
  all clean (no new tests for the dropdown UI itself — no React
  component/hook testing infra in this project, same established
  precedent; `recent-commands.ts`'s own pure logic is fully tested).

## Terminal: clear the Terminal.app preamble (2026-10-21)

Founder caught this live: a restored terminal's first visible line was
Terminal.app's own "typed" invocation of the generated `.command`
file's full path plus a trailing `; exit` — not a bug in this app's
own script content, just how macOS's Terminal.app has always visually
represented opening a `.command` file (same whether via `open -a
Terminal` or a double-click; nothing this project's own script
controls). The trailing `; exit` never actually closes the window
early, since the script's own last line (`exec "$SHELL" -l`) replaces
the process before that `exit` gets a chance to act — confirmed by the
founder's own pasted terminal output ending in a normal, live prompt.
Added a `clear` as the script's third line (`macos/launcher.ts`,
`terminal-tool.ts`'s `detail()`/`expand()` wiring unaffected) purely
to wipe that noisy preamble before the user's own commands run —
cosmetic only, confirmed live by generating the script directly and
reading its contents back, plus a real `open -a Terminal` round trip.
Updated both exact-script-content tests in `macos/launcher.test.ts`
accordingly. 626/626 tests, lint/typecheck/build clean.

## Terminal: echo each command before it runs (2026-10-21)

Founder pushback, same day as the `clear` fix above: a plain shell
script never echoes its own commands by default, so a restored
terminal showed each command's *output* with nothing indicating what
produced it — looked like nothing was happening at all for a silent
command (confirmed earlier that day with `caffeinate`, which genuinely
runs but prints nothing). Also surfaced a real "why not just open a
terminal and type the command" design question, worth the record:
that's effectively what AppleScript's `do script` would do, and it's
exactly what this feature deliberately avoided — embedding command
text into an AppleScript string is the same two-layer escaping problem
already fixed once in this file; simulating real keystrokes via
Accessibility/TCC would reopen the macOS permission-complexity class
this project has repeatedly chosen not to reopen.

Fixed by echoing each command as its own `$ <command>` line
immediately before it runs — `macos/launcher.ts` now has a small
`singleQuote()` helper (shared between `cwd` and each echoed command
label) so the echo text is embedded into its own, separately-escaped
single-quoted string rather than ever reusing one escaped string
across two different quoting contexts — the exact mixed-context bug
class the earlier security review caught once already. The command's
own execution line stays completely verbatim and unescaped, same as
before. New test confirms both the escaping (a command containing a
literal apostrophe) and the ordering (echo line immediately precedes
its command). Verified live: generated the real script, opened it, and
confirmed via screenshot that `$ echo "..."` / `$ npm --version` lines
appear correctly before their own output. 627/627 tests,
lint/typecheck/build clean.

## Known, deliberately deferred issue

`apps/desktop` has no plain `tsconfig.json` (only `tsconfig.node.json` +
`tsconfig.web.json`), so VS Code's editor can't discover which config
applies to renderer files. Shows as false-positive red errors in the
editor — the _real_ `npm run typecheck` has been clean every time
regardless. Fix proposed once, declined once; still open, no urgency.

## Verified state as of the last real check

Lint / typecheck (4 workspaces) / test (**619/619**) / build (main,
preload, renderer, vscode-extension) all clean as of 2026-10-21
(489 after removing the mock-workspace feature and its now-obsolete
tests plus a new multi-active-workspace Switch regression test, +35
for the real launch-time display, +2 from an 8-agent review pass
across every change in this batch, +1 net from folding
`step-row-summary.ts` into `step-fields/registry.ts`, +37 for real
app-location detection (its own `/judge` round plus the adversarial
review's fixes), -1 from switching app-detection to mdfind (fewer
directory-walk edge cases to cover), +38 for the Terminal step type
(its own full `/judge` round plus the plan-stage adversarial review's
fixes), +8 from a second, post-build 4-agent review round that found
and fixed a real renderer bug, a real UX labeling bug, and 2 smaller
correctness issues — see "What's shipped since 2026-09-22" and
"Terminal step type" above). Three
full multi-agent review rounds ran against this codebase earlier
(round 1-2: 2026-09-18, round 3: 2026-09-22 — 12+ review-agent passes
total); every real, concrete bug found across all three has been fixed
with a regression test; every unverified-and-can't-verify-without-
disrupting-something risk (Windows already-running-app behavior, the
Chrome cold-start multi-tab race, the Windows titlebar overlay, Spotify's
Windows URI handling) is explicitly flagged in the code and here, not
silently assumed fine. Everything built since 2026-09-22 (see that
section above) was live-verified via Playwright driving the real built
app rather than a full multi-agent review round — a lighter-weight
verification bar than rounds 1-3, appropriate for founder-reviewed
incremental features rather than a pre-ship audit.

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
2. **The next tool plugin** — Docker is the natural follow-up now that
   Terminal has shipped (2026-10-21): Docker's "run compose/tilt
   command" is a close cousin of what Terminal's `PlatformLauncher`
   plumbing already does, and it's literally the other half of the
   pitch doc's own lead line ("Docker's up, Tilt's running"). Slack
   stays deprioritized per the founder's own earlier call. The
   per-type-branching refactor this item used to call for (2026-10-20)
   turned out mostly already done by
   earlier work in the same round: `WorkspaceFormModal.tsx`'s
   `StepParamsFields` and `workspace-display.ts`'s `describeStep`
   already dispatch through a type-keyed lookup, not an `if` chain
   (confirmed by a fresh Explore pass before touching anything, rather
   than trusting this stale note). The one real piece that was still a
   bare `switch (type)` — `step-row-summary.ts`'s per-row collapsed
   summary — has been folded into `step-fields/registry.ts` as a third
   per-type field (`summary`, alongside `Component`/`hasPrimaryInput`/
   `collapsible`), with each type's actual summary logic moved into a
   new pure `step-fields/step-summaries.ts` (kept out of the
   `*-fields.tsx` component files deliberately — mixing a non-component
   export into one broke Fast Refresh, caught by lint). A few
   deliberate, scoped single-type exceptions remain on purpose, not
   growing chains: the generic 'app' type's dynamic display name
   (`workspace-display.ts`'s `stepDisplayName`, `WorkspaceFormModal.tsx`'s
   `rowName`, `ToolBadge.tsx`'s icon sizing) — each is a one-off
   override for a type that genuinely isn't one fixed thing, not
   evidence of a chain to eliminate. Real remaining architectural note,
   not fixed (and not obviously fixable): `step-fields/registry.ts`
   (renderer-only) and `main/tools/registry.ts`'s `ToolPlugin` registry
   are two independent, unconnected registries with no shared method —
   inherent to Electron's main/renderer process split (main can't hand
   the renderer a live React component reference across that
   boundary), not a DRY violation to force-unify.
3. Everything in `claude.md`'s "ship-readiness" list (code signing,
   licensing, auto-update, crash reporting) — explicitly deferred until
   there's something real to actually ship.
