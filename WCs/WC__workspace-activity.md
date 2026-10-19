# Restore / Switch / Close — Workspace Activity Tracking

Three actions for a workspace that's already running, instead of one
"restore" that quietly leaves the previous workspace's apps open
forever: **Restore** (additive, unchanged), **Switch to this
workspace** (a full context change), and **Close this workspace**
(drop just this one). Source of truth is `orchestrator.ts`'s
`switchToWorkspace`/`closeWorkspace`, `tool-identity.ts`, and
`platform/macos/process-control.ts`; this doc explains why it's shaped
the way it is — including a rejected first design, since the reasoning
behind the rejection shaped everything that followed.

## What it does

- **Restore** — unchanged. Opens whatever this workspace needs, never
  closes anything. This is what two workspaces running in parallel
  (two client projects, two companies) already use, with zero new
  logic — see "Why Restore needed no changes" below.
- **Switch to this workspace** — shown whenever another workspace is
  currently active. Reconciles *everything* currently running
  (regardless of which workspace it came from) to match just this
  one: closes what's not needed, opens what's missing, leaves Chrome
  alone either way.
- **Close this workspace** — replaces the Restore button once this
  workspace is already active. Closes only this workspace's own apps,
  skipping anything another currently-active workspace still needs.
- No action ever prompts. Each one computes its result and reports it
  afterward (closed / opened / left-running-and-why).

## The rejected first design, and why

The first version asked a keep-or-close question on every restore
when another workspace was active. The founder's reaction: "its not
intuitive at all" — not a UI polish complaint, a wrong mental model.
Real usage (a RAM-constrained full switch between two clients; the
same company shape with a slightly different app set; dev-you in the
morning sharing Chrome/Spotify with personal-you in the evening) all
turned out to be the same underlying operation — a diff between what's
running and what the target needs — not a yes/no decision to surface
per restore. Once "switch" became a *computation* instead of a
*question*, the keep-or-close prompt disappeared entirely, replaced by
two distinctly-named actions whose names alone tell you which one you
want (see `WORKING-DECISIONS-TEMP.md` item 6 for the full back-and-forth).

## Why Restore needed no changes

`open -a` is already idempotent — restoring an already-open app just
refocuses it (confirmed existing behavior, not new). So "Switch to
X"'s open side is just: call the existing `runWorkspace(X)` unchanged.
The only genuinely new execution logic in this whole feature is the
*close* side.

## Identity, not app name

Two steps count as "the same" only if they're the same tool type *and*
the same target — VS Code open to project A and VS Code open to
project B are different identities, even though "VS Code" is one app.
A tool with no distinguishing target (Spotify, Clockify) is the same
identity everywhere it's referenced. `tool-identity.ts`'s
`getMacAppName(type, params)` derives this: a fixed per-type constant
for vscode/chrome/spotify/clockify (now exported from each tool file —
single source of truth, not a duplicated string), and
`appDisplayName(params.path)` for the generic `'app'` type.

## One global running-fact, not a per-workspace ownership ledger

Settled while resolving the "what if I want A and B running at the
same time" case: there's no need to track *which workspace* owns a
running app. Just one fact — what's currently running, by identity —
plus each workspace's own tool list (already on disk). Restore unions
into it; Switch diffs the whole thing against one target; "Active" per
workspace is derived from it, not stored as its own source of truth.
`orchestrator.ts`'s `buildRunningAppNameMap` computes this once per
call (deduped across every config, parallelized), not once per step.

## "Active" = intent AND liveness, never liveness alone

A workspace's intent flag (`workspace-activity-store.ts`, persisted,
mirrors `step-timing-history.ts`'s exact shape) is set by Restore/
Switch-to and cleared by Close. Liveness (is anything this workspace
needs actually still running) can only turn displayed "Active" **off**
— it can never turn it **on** for a workspace nobody touched. This
was a real bug caught mid-design, not in build: without the intent
half, a workspace that merely references a shared no-target tool
(Spotify) would show falsely "Active" the moment *any other* workspace
turned Spotify on, even if this one was never restored. Switching
clears every *other* workspace's intent too (a full context change
means leaving all of them, even one that still has a shared tool open
for someone else's sake); Close only ever clears its own.

## Liveness and closing are both name-based AppleScript, never PID

Researched and ruled out: macOS's `open -a` is a broker that exits
immediately and never hands back the launched app's real PID; polling
for one afterward is racy, and Chrome's multi-process-per-profile model
makes "the app's PID" ill-defined anyway. Both primitives
(`process-control.ts`) go by app **name** instead —
`osascript -e 'application "X" is running'` and
`osascript -e 'tell application "X" to quit'` — graceful, not a force
kill, which is a safety property: quitting VS Code via AppleScript
still triggers its own unsaved-changes prompt, so a workspace switch
can never silently discard work. Liveness is checked fresh every time
(lazily, when a workspace's Detail view renders and right before
Switch/Close compute their diff) — never persisted, so it can't go
stale, unlike the intent flag above.

## Two known v1 limitations — flagged, not solved

- **Chrome is excluded from auto-close entirely.** It's a singleton
  process per profile — asking it to open a different profile routes
  through the already-running process rather than spawning a new one,
  so there's no way to close "just this profile" without real risk of
  closing more than intended. Still liveness-checked (for Active
  display correctness); never quit. Switch/Close always report it as
  "left running (not auto-closed)."
- **VS Code's liveness is app-level, not per-window.** The name-based
  "is it running" check can't tell two VS Code windows (two different
  projects) apart — if one of two open project windows is closed
  manually, the check still reports VS Code running until the whole
  app quits. Smaller in practice than the Chrome case, but real.

## No `ToolPlugin` interface change

`teardown()`'s signature (`params` only, no `RunContext`) stays
exactly as it is — deliberately not reused here. The two capabilities
this feature needs (an app name per step, an exclusion flag per type)
don't need to live on every tool plugin; a small module that switches
on `step.type` is simpler than widening a shared interface — and the
tool-name constants, teardown included — for a macOS-only, v1 feature
five of eight step types don't even participate in.

## macOS only, v1

Same scope cut as the generic 'app' step type: no Windows equivalent
of name-based AppleScript control exists. `WorkspaceDisplay.active` is
always `false`/absent off-macOS (`handlers.ts`'s
`SUPPORTS_WORKSPACE_ACTIVITY` guard, checked before any osascript call
is even attempted), so the Switch/Close buttons never appear there —
the feature is invisible, not broken, on Windows.

## Testing

`tool-identity.test.ts` and `process-control.test.ts` are pure/mocked
unit tests. `workspace-activity-store.test.ts` mirrors
`step-timing-history.test.ts`'s fake-store precedent. `orchestrator.
test.ts`'s `switchToWorkspace`/`closeWorkspace` suites cover: closing
only what's unneeded, never touching Chrome or a still-needed-elsewhere
tool, correctly delegating the open phase to `runWorkspace`, and the
intent-flag rules (including Switch clearing every other workspace).
`handlers.test.ts` covers the two new IPC-facing functions and
`listWorkspaces()`'s `active` field — including the exact bug this
feature's design round was built around: a workspace that merely
shares a no-target tool with an active one never shows falsely active.

A real bug was caught and fixed *during this feature's own build*, not
via live testing: the first pass of `listWorkspaces()`'s `active`
computation shelled out to **real** `osascript` in the test suite,
because `process-control.ts` wasn't mocked in `handlers.test.ts`/
`orchestrator.test.ts` yet. Caught by a 5-7x jump in those files' test
runtime (not a failure — the calls succeeded, just slowly and
non-hermetically), fixed by mocking it wholesale the same way
`app-icon.ts`/`chrome-profiles.ts` already are in `handlers.test.ts`.
Live UI verification skipped per the founder's standing instruction —
they're testing directly.

## Found and fixed in a 5-angle review pass, right after shipping

This feature went through a deliberate multi-agent review (bugs,
security, UX comfort, UI consistency, architecture) immediately after
the build above was marked done. Four things were serious enough to
fix before calling it finished — recorded here because they're the
kind of mistake worth not repeating:

- **[Critical] Plain Restore never set intent.** `restoreWorkspace`
  called `runWorkspace` directly; only `switchToWorkspace`/
  `closeWorkspace` touched the intent store. Since Restore is the
  *only* reachable first action for any workspace, nothing could ever
  become "Active" through normal use — Switch/Close's own "another
  workspace is active" conditions could never trigger either. Fixed
  by moving the `setIntentActive(config.id, true)` call into
  `runWorkspace` itself, so every caller (plain Restore, and Switch's
  own internal call) gets it for free.
- **[High, security] AppleScript injection via the generic 'app' step
  type.** `isAppRunning`/`quitApp` originally interpolated the app
  name directly into the AppleScript source string. Confirmed
  exploitable: a crafted step `path` (reachable via a hand-edited,
  imported, or synced config file — not just the file-picker's happy
  path) could break out of the string literal and run an arbitrary
  shell command, with no user action beyond having the app open
  (`listWorkspaces()` checks liveness for every config on every
  launch). Fixed by passing the app name as a real `argv` entry to an
  `on run argv` handler instead of ever building script text from it
  — makes a break-out structurally impossible regardless of content.
  A related, lower-severity path-traversal in the *existing*
  `app-icon.ts` (a crafted `CFBundleIconFile` could point `sips` at an
  arbitrary file outside the bundle) was fixed alongside it.
- **[High] A failed quit was silently dropped, and intent was cleared
  anyway.** `closeWorkspace` unconditionally cleared the workspace's
  intent even when `quitApp` failed (e.g. VS Code declined to quit
  over unsaved changes) — the UI would then say "closed," while the
  app was actually still open. Fixed: a failed quit is now a real
  `leftOpen` entry (`reason: 'failed'`, carrying the failure message),
  and intent is only cleared when nothing failed.
- **[UX] Restore disappeared exactly when it was most needed.** The
  first version replaced the Restore button with Close once a
  workspace went Active — so a workspace with a partially-crashed app
  (one tool quit outside this app, another still open) had no way to
  just re-open what died; `open -a`'s own idempotency already made
  Restore the correct repair action, it just wasn't reachable. Fixed:
  Restore is now always present; Close/Switch are additive, shown
  alongside it rather than replacing it.

Two smaller fixes from the same pass: `closeWorkspace` checked
exclusion/still-used *before* liveness, producing a misleading "left
X running" for an app that was never running at all — reordered to
check liveness first. The per-step Retry button and a Switch/Close in
flight could race and splice a stale retry result into an unrelated
`stepResults` array — fixed by disabling Retry while Switch/Close is
running and vice versa (`RestoreResults`'s new `disabled` prop).

## Found live, by the founder, right after the review pass above

- **[Critical] Switch could close an app that belonged to nobody.**
  Reported directly: two real workspaces (Figma, ProtonVPN — each just
  launches that one app, neither references VS Code at all), restore
  one, Switch to the other — and it closed the founder's own,
  completely unrelated, real VS Code window. Root cause:
  `switchToWorkspace`'s "what's currently running" set was computed
  from `allConfigs` — *every* known config, including this app's own
  bundled demo/mock workspaces (`client-a`, etc., shipped with the app,
  never restored by the founder) — not just workspaces actually made
  active through this app. One of those demo configs has a `vscode`
  step; the founder's own real, unrelated VS Code happened to be open;
  the app name matched; it got closed. Fixed: an app is only ever a
  candidate for closing if it belongs to some *other workspace that is
  itself currently active* (intent + liveness) — never merely because
  some config, used or not, mentions a matching app name. This is the
  single most important correctness property of the whole feature —
  "never touch something that isn't yours" — and the first version
  didn't actually have it for Switch's close side, despite being the
  explicit design goal throughout. `closeWorkspace` was never affected
  (it only ever iterates the target's own steps).

**Raised but deliberately left as-is**, each a real product call, not
a bug:

- Switch/Close never prompt before closing a real app with unsaved
  state — by design (see "The rejected first design" above); the
  safety net is the app's own native save-changes prompt, not an
  in-app confirmation. Worth knowing this is a conscious tradeoff, not
  an oversight, if it ever surprises someone.
- The "Active" pill is a flat yes/no with no partial state, which can
  overclaim given VS Code's app-level (not per-window) liveness limit
  — tooltip wording was softened ("at least one... is still open")
  but the underlying binary-ness wasn't changed.
- A red `ER-*` error-code badge reads more like developer-support
  tooling than the friendly, typing-free style the rest of this app
  (and the non-dev personas the generic 'app' type targets) uses —
  flagged for a future design pass, not changed here.
