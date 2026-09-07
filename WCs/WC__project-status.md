# Project Status

Last updated: 2026-09-07. Snapshot of what's real, what's scaffolded, and
what's next — for picking the project back up after time away.

## Where the code actually lives

Nothing has been committed since `7f55e1b` ("Convert renderer to React;
add single-instance lock + native app menu"). Everything below —
platform launcher, VS Code tool, orchestrator wiring, adaptive timeout,
the full Tailwind/shadcn migration, and the review-pass bug fixes — is
sitting **uncommitted in the working tree** (~40 changed/new files).
Nothing lost, nothing else touched it since; just not committed or
pushed yet. That's the first thing to do before anything else.

## What's real (built, wired, tested)

- **App launches**: Electron + React renderer, single-instance lock,
  native app menu (copy/paste works), frameless window with correctly
  positioned real traffic lights.
- **Platform launcher** (`platform/macos/launcher.ts`) — real `open -a`
  calls, argv-array/`shell:false` throughout (command-injection-safe).
- **One real tool plugin**: `vscode-tool.ts` — actually opens VS Code
  via the platform launcher, tilde-expansion (`~/...`) handled.
- **Orchestrator wired end-to-end**: clicking "Restore workspace" in
  the UI really calls through IPC → orchestrator → tool → platform →
  shell. Real per-step results (success/fail + message) shown in the
  UI, not decoration.
- **Adaptive step timeout** (`orchestrator/step-timing-history.ts`) —
  2-hour default per step until 3 successful runs are recorded for
  that tool type, then 1.5× the real historical average. Persisted via
  `electron-store` (pinned to `^8.x` — v9+ is ESM-only and breaks the
  CJS main-process build, this bit us once already).
- **Design system**: full Tailwind v4 (`@theme`-based, no
  `tailwind.config.js`) + shadcn (`components/ui/dialog.tsx` — real
  Radix `Dialog`, not a hand-rolled overlay). Indigo accent + full
  palette, tool/tag color lookup pattern. Written up in
  `WCs/WC__design-system.md`.
- **Config validation path exists but isn't wired to the UI**:
  `config/loader.ts` reads/validates real workspace JSON files from
  `userData/workspaces/` (dedup'd, sorted, tested) — nothing calls it
  yet, since there's no real workspace-creation flow.

## What's still fake / not wired

- **The 5 workspaces you see are hardcoded mock data**
  (`ipc/mock-workspaces.ts`), not anything persisted. Only their
  `vscode` steps are real; every other step type (Docker, Terminal,
  Chrome, Slack, Spotify) correctly reports "no registered tool" —
  honest, not faked.
- **"New workspace" → Save does nothing.** You can build a step list
  in the modal UI; nothing persists. This is the biggest real gap —
  until this exists, there's no way to restore anything but the 5 fake
  workspaces, and no way for `step-timing-history`'s real averages to
  ever mean anything.
- **No workspace ID generation** — ties directly to the above; nothing
  has ever needed to generate one yet.
- Search bar, workspace kebab menu, Settings button — decorative only.
- VS Code companion extension — scaffold only, one placeholder command.

## Known, deliberately deferred issue

`apps/desktop` has no plain `tsconfig.json` (only `tsconfig.node.json`
+ `tsconfig.web.json`), so VS Code's editor can't discover which
config applies to renderer files. Shows as 3 false-positive red errors
in the editor (`window.api` unknown, an implicit `any`, an unresolved
CSS import) — the *real* `npm run typecheck` (which explicitly passes
`-p tsconfig.web.json`) has been clean every single time regardless.
Fix proposed once, declined once; still open, no urgency.

## Verified state as of the last real check

Lint / typecheck / test (47/47) / build all passing, app launches
without crashing. That was the state at the end of the last working
session — nothing has touched the repo since, so it should still hold,
but worth a fresh `npm run lint && npm run typecheck && npm run test
&& npm run build` before building on top of it, purely because time
has passed (dependency drift, environment changes), not because
anything in the repo itself changed.

## Natural next steps, in order of what unlocks the most

1. **Commit + push** what's sitting in the working tree.
2. **Real workspace persistence** ("New workspace" → Save actually
   writes a config `config/loader.ts` can read back) — unlocks
   everything else being real instead of fake.
3. **The next tool plugin** — Docker, Terminal, Chrome, Slack, or
   Spotify, following `vscode-tool.ts`'s exact pattern.
4. Everything in `claude.md`'s "ship-readiness" list (code signing,
   licensing, auto-update, crash reporting) — explicitly deferred
   until there's something real to actually ship.
