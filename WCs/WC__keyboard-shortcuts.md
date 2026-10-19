# Keyboard Shortcuts & Search

A real, user-customizable keyboard-shortcut system — not a one-off Cmd+K
wire-up. Backs the sidebar's search box (`App.tsx`) and the Settings
modal's Shortcuts section (`SettingsModal.tsx`). Source of truth for
behavior is `lib/shortcuts.ts`/`lib/useGlobalShortcuts.ts`; this doc
explains the design choices that aren't obvious from reading either file
alone.

## What it does

- `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) focuses the sidebar search box,
  which filters the workspace list live as you type.
- `Cmd+,` / `Ctrl+,` opens Settings.
- Every shortcut is rebindable from Settings → Shortcuts: click a row,
  press a new combo, it's recorded (or rejected with a reason) and
  persisted immediately.
- The registry (`SHORTCUTS` in `lib/shortcuts.ts`) is the only place a
  future feature needs to touch to gain its own rebindable shortcut — it
  then shows up in the Settings list automatically, no special-casing
  anywhere else.

## Why a registry, not a hardcoded Cmd+K

The founder explicitly asked for "the actual shortcut system," not a
single wired-up combo, because future features will each want their own
default binding. `SHORTCUTS: ShortcutDefinition[]` (id, default combo,
label, `allowInInput`) is the one place that list lives;
`getEffectiveShortcuts()` merges it with any stored overrides at read
time — nothing else in the app hand-maintains a second copy of "what
shortcuts exist."

## Mechanism: renderer-level `keydown`, not Electron's `globalShortcut`

Three ways to bind a key in Electron, one of them correct here:

- **`globalShortcut`** — system-wide, fires even when the app isn't
  focused. Wrong tool: these actions (focus search, open settings) only
  make sense while the app is already the foreground window.
- **Menu accelerators** — for real menu items. These aren't menu items.
- **Renderer-level `keydown`** (what's actually used,
  `useGlobalShortcuts.ts`) — correct: in-app-only, no special Electron
  API needed, and the same mechanism any future shortcut will use too.

`CommandOrControl` is Electron's platform-neutral accelerator token,
reused here even though this is plain DOM `keydown` handling (not a real
Electron accelerator string) — `matchesCombo()` resolves it to `metaKey`
on Mac / `ctrlKey` elsewhere, one token instead of maintaining two
per-platform default combos.

## Interaction model: hard-blocking, not silent overwrite

Settled explicitly with the founder: if a user tries to bind a combo
that's already taken (by another shortcut, or an OS/app-reserved combo
like Cmd+Q), the rebind is rejected with a reason shown inline — never
silently reassigns the other shortcut out from under them.
`validateCombo()`/`findConflict()` in `lib/shortcuts.ts` are the two
gates every rebind attempt passes through before being persisted.

Reserved combos are platform-specific (`MAC_RESERVED`/
`WIN_LINUX_RESERVED`) — Cmd+Q/W/Tab/Space/H/M and the screenshot combos on
Mac, their Windows/Linux equivalents separately. **Cmd+, is deliberately
NOT in `MAC_RESERVED`** despite looking like a reserved system combo — it
was originally blocked as "not yet implemented," then unblocked once
Settings itself started using it as its own real, intentional default
binding (see "Bugs found" below).

## Persistence: `localStorage`, not an account/backend

Raised and settled explicitly: the founder asked whether per-user
shortcuts should be stored server-side given this app's
eventual-SaaS/multi-device future. Decided **not** to build accounts for
this — plain `localStorage`, scoped to this one device, same tier as the
theme preference. Revisit only if real multi-device sync becomes an
actual product requirement, not preemptively for a single-device desktop
app's keybindings. `getStoredOverrides()`/`setShortcutOverride()` read
and write the `workspace-launcher:shortcuts` key directly — no schema
migration concerns yet since it's a simple id→combo map.

## Bugs found and fixed (all caught before/during adversarial review, not after shipping)

- **Stale-closure effective-shortcuts list**: `useGlobalShortcuts`
  originally computed `getEffectiveShortcuts()` once per `useEffect` run,
  not per keypress — a rebind made in Settings while the app stayed open
  wouldn't take effect until something unrelated happened to re-run the
  effect. Fixed by recomputing fresh inside `onKeyDown` itself, every
  keystroke.
- **Radix Dialog's Escape vs. a recording row's own Escape handling**:
  Settings is a Radix `Dialog`; Radix's own Escape-to-close listener is a
  **capture-phase** `document`-level listener (confirmed by reading
  `@radix-ui/react-dismissable-layer`'s actual source) — it fires before
  React's bubble-phase synthetic handlers, so a `ShortcutRow`'s
  `stopPropagation()` while recording a new combo can never block it.
  Pressing Escape to cancel an in-progress recording would also close the
  whole Settings modal. Fixed via `DialogContent`'s `onEscapeKeyDown` +
  an `isRecordingRef` the dialog checks before letting Escape close it.
- **Exact-modifier-set gap**: `matchesCombo` originally only checked that
  a combo's *required* modifiers were held, not that no *extra* ones
  were — `CommandOrControl+K` would incorrectly also fire for
  `CommandOrControl+Shift+K`. Fixed to check every modifier flag exactly,
  with a regression test.
- **Search-pill staleness** (founder, live): the search box's `⌘K` pill
  showed the hardcoded default combo even after rebinding it — it read
  `SHORTCUTS.find(...)?.defaultCombo` instead of the actual effective
  combo. Fixed with a `searchCombo` state recomputed whenever Settings
  closes.
- **Cmd+, reserved-list contradiction**: adding `settings.open`'s default
  combo as Cmd+, directly conflicted with `MAC_RESERVED` already
  including it (blocked there specifically because it wasn't implemented
  yet). Removed from the reserved list once it became a real, intentional
  binding — see "Interaction model" above.

## Testing

No jsdom in this project's Vitest setup (`environment: 'node'`), so — same
precedent as `vscode-restore.ts`/`write-file-atomic.ts` — the testable
logic is pulled out of the hook and tested directly:
`matchesCombo()` (`useGlobalShortcuts.test.ts`, exact-modifier-set
regression included) and the registry/persistence/validation functions in
`shortcuts.ts` (`shortcuts.test.ts`) are fully covered; the hook itself
(`useGlobalShortcuts`) and the Settings UI components are not
directly tested, consistent with this app's established no-DOM-test-infra
precedent for components.

Live-verified end to end via Playwright driving the real built app,
including rebinding surviving a full app restart (confirms the
`localStorage` round trip, not just the in-memory state).
