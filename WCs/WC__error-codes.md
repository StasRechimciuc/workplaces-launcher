# Error Codes + the Errors Page

Every surfaced error gets a short, stable code alongside its free-text
message, plus a "Learn more about this error" link into a dedicated,
searchable Errors page — modeled explicitly on Netflix's own error-code
UX. Source of truth is `packages/shared/src/error-codes.ts` and
`components/ErrorsModal.tsx`/`ErrorCode.tsx`; this doc explains why it's
shaped the way it is.

## What it does

- A new `'app'`-style catalog: `ERROR_CODES` (`ER-<CATEGORY>-<NN>`, e.g.
  `ER-CHROME-01`), one entry per *category* of failure, each with a
  plain-language title and explanation.
- Every failed `StepResult` and every `{success: false, error}` IPC
  result now also carries an optional/required `code`.
- `ErrorCode.tsx` — one shared presentational component — renders the
  message plus, when a code is present, a small badge and a "Learn more
  about this error" link.
- That link opens `ErrorsModal.tsx`: a static, searchable catalog of
  every known code. **Reachable only via that link** — not from
  Settings, not from the Sidebar, per the founder's explicit design.

## Why category codes, not one per throw site

Settled via `/judge` research into real prior art before building
anything: Windows bugchecks (~250 codes covering an entire OS, via
facility+code fields), PlayStation's CE-/NP-/NW- prefixes (one code
shared by many underlying failures), Stripe's two-tier `type`/`code`.
Nobody does one code per call site — it drifts into unmaintainable
near-duplicate catalog entries as the app grows, and splits one real
user-facing situation across several almost-identical explanations.
One code per *user-meaningful category* (same cause, same remediation),
reused across every call site that produces it, is both self-documenting
and sustainable for this app's realistic ~14-code surface.

## Why a keyed const, not a bare array

`step-types.ts`'s existing "array + derived Map" shape was the obvious
pattern to mirror, but a bare array would mean every throw site
retypes a string literal (`'ER-TOOL-01'`) that nothing checks against
the catalog except a test someone has to remember to write and keep in
sync. Instead, `ERROR_CODES` is a keyed const
(`ERROR_CODES.TOOL_NOT_FOUND.code`), so every reference is a real
property access — a renamed or removed code becomes a compile error at
every call site instead of a silent runtime drift only a dedicated
cross-reference test would catch. `ERROR_CODES_LIST` (`Object.values`)
and `getErrorCode(code: string)` are exported alongside it for the two
cases a keyed const alone doesn't cover: the catalog page's iteration/
search, and resolving a code that's only available as a plain string
(already serialized over IPC by the time the renderer sees it).

## Where codes are assigned

At the tool-plugin/IPC-handler boundary — the user-facing layer — never
threaded through the internal platform/shell layers
(`platform/macos/launcher.ts`, `lib/shell-exec.ts`). The message string
still carries whatever OS-level detail actually failed; the code only
identifies the category for catalog lookup. This kept the change
mechanical and bounded: no new field had to be plumbed through every
internal function, just added at each of the ~15 places a `StepResult`
or IPC result is actually constructed (`orchestrator.ts`, each tool's
`run()`, `handlers.ts`, `spotify/auth.ts`).

One genuinely new category was found while implementing, not
anticipated in planning: `spotify/auth.ts`'s `connect()` has its own
distinct failure path (the OAuth round trip itself failing — denied,
cancelled, no default browser, missing client id) separate from
`ER-SPOTIFY-02`'s "couldn't load playlists." Rather than force-fit it
into an existing code, a new `SPOTIFY_CONNECT_FAILED` (`ER-SPOTIFY-03`)
entry was added, following the same category scheme.

## Why the Errors page reuses this app's one existing modal pattern

Confirmed via Explore before building: no React Context exists
anywhere in this renderer. Every existing modal (`SettingsModal`,
`DeleteWorkspaceConfirm`) is state-owned-in-`App.tsx` + a prop-drilled
callback, mounted as a sibling at the bottom of the tree. `ErrorsModal`
does the exact same thing — a new `errorsModalCode: string | null`
state in `App.tsx`, and a new `onShowErrorCode` callback threaded down
through `Detail`/`RestoreResults`/`TimelineStep`/`WorkspaceFormModal`,
the same way `onEditWorkspace`/`onDeleteWorkspace` already are. No new
state-management mechanism was invented for this one feature.

The modal always opens already pointed at a specific code (it has no
entry point of its own to open "blank" from). Its search box starts
empty, but — per a founder follow-up once the catalog's real growth
trajectory was considered ("we will have lots of errors... dont need
to fetch all of them in 1 go") — the no-search default view shows only
the triggering code plus others sharing its category prefix
(`categoryOf()`, parsed from the `ER-<CATEGORY>-<NN>` format itself,
not a separate stored field), not the entire catalog. Typing a search
searches every code, title, and explanation across the full catalog,
capped to 50 results (`SEARCH_RESULT_LIMIT`) with a "showing N of M"
note when truncated, so a broad query can't render hundreds of rows at
once as the catalog grows. The row matching the triggering code is
highlighted and scrolled into view in the default view, so the user
immediately sees which entry brought them there.

## What stays out of scope, deliberately

No history/persistence — this is a static reference catalog ("what
does this code mean"), not a log of past occurrences, matching exactly
what the founder described wanting. Internal "malformed IPC payload"
guards in `handlers.ts` (shapes the renderer itself never sends) stay
uncoded — they're not reachable through normal use, so a code there
would be noise, not help, for a real user.

## Testing

`error-codes.test.ts` mirrors `step-types.test.ts`'s own pattern:
every code unique, every entry has a non-empty title/explanation,
`getErrorCode()` resolves every keyed entry's own code back to itself
and returns `undefined` for an unknown one without throwing.
`orchestrator.test.ts`, `handlers.test.ts`, `auth.test.ts`, and each
tool plugin's own test file were extended at their existing
failure-path assertions to also check `.code`, in the same style each
file already used (`toEqual`, `toMatchObject`, or a narrowed
`if (!result.success)` block). No new component test for
`ErrorCode.tsx`/`ErrorsModal.tsx` — matches this repo's established
precedent (no DOM test infra; `SettingsModal.tsx`/`RestoreResults.tsx`
aren't unit-tested either). Fully verified (lint/typecheck/457
tests/build). Live UI verification skipped per the founder's standing
instruction — they're testing directly.
