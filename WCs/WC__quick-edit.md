# Inline Quick-Edit from the Detail View

Editing a step's params directly from an expanded row in the Detail
view, instead of requiring the separate "Edit workspace" modal.
Source of truth is `components/Detail.tsx` and `components/TimelineStep.tsx`;
this doc explains why it's shaped the way it is.

## What it does

Expanding a step in Detail (VS Code, Chrome, Spotify, or the generic App
type) shows the **exact same editing UI** the "Edit workspace" modal
already uses for that tool type — real pickers (Chrome's profile
dropdown, Spotify's OAuth+playlist picker, VS Code's folder dialog, the
App type's native app picker), never a raw text box. An explicit
checkmark/✕ pair saves or discards the change; nothing auto-saves per
keystroke.

Scoped to the step types that have both a registered, collapsible
`StepFieldsComponent` *and* real content to edit — today vscode/chrome/
spotify/app. Read-only (mock demo) workspaces never show it, matching the
existing Edit/Delete gating.

## Why reuse, not reinvent

A naive version of this feature would just make the existing read-only
`expand()` row text-editable in place. That was explicitly rejected
before building: Chrome's profile and Spotify's playlist are real
dropdowns backed by `Local State`/OAuth, not free text, and VS Code's
path has a native folder dialog — a raw text box here would regress
this app's own "no manual typing" picker work. `StepFieldsComponent`s
have no hardcoded widths tying them to the modal, so they're safe to
reuse wholesale in Detail's wider content area.

## Data flow

`window.api.updateWorkspace({id, name, steps})` always overwrites the
*whole* config — there's no per-step PATCH IPC. A quick-edit save
reconstructs the full `steps` array via `lib/replace-step-params.ts`
(every other step untouched, reference-equal — only the edited step's
`params` is replaced), then sends the same payload shape
`WorkspaceFormModal.tsx`'s own save already sends. No new client-side
validation needed: `handlers.ts`'s `validateStepsWithRegisteredTools`
already runs server-side on every `updateWorkspace` call regardless of
caller.

## State ownership

`Detail.tsx` owns `draftParams`/`isSavingStep`/`saveStepError` —
mirrors the existing one-at-a-time `expandedIndex` pattern. The draft
resets to `null` whenever a *different* step is expanded, so switching
which row is open never carries over a stale, unrelated draft. Switching
to a different *workspace* entirely remounts `Detail` (existing
`key={workspace.id}`), which discards any in-progress draft for free —
no special-case code needed.

## Save/Cancel visibility — founder-driven iteration

Two rounds of live feedback shaped the final behavior:

1. **First version**: Save/Cancel always visible once a step was
   expanded, merely *disabled* until something changed. Correct in
   principle (nothing to save/cancel yet) but read as broken UI — a
   permanently-visible-but-greyed-out button pair looks like a bug, not
   an empty state.
2. **Fixed**: the whole Save/Cancel row only renders once
   `draftParams !== null` — i.e. once an actual edit has been made.
   Nothing shown at all until there's something to act on.

## The Clockify cascade

A related founder-caught bug during this round: Clockify (nothing to
configure at all) was briefly showing a pointless expand chevron +
disabled Save/Cancel pair, because the quick-edit `Fields` gate
originally only checked "is a `StepFieldsComponent` registered for this
type," and Clockify *was* registered (its component just explained there
was nothing to configure). Fixed by also gating on the step-fields
registry's `collapsible` flag — already this codebase's existing signal
for "genuinely nothing to configure," previously used only by
`WorkspaceFormModal.tsx`'s Tools list for the identical reason.

That fix, combined with a later founder request to move Clockify's
message onto its header line (`Clockify · Nothing to configure`, one
line, matching every other type's `name · subtitle` pattern) instead of
a separate block below, made `ClockifyFields` unreachable from **every**
call site in the app. Rather than leave it as dead-but-present code,
it was deleted outright and Clockify's registry entry removed entirely —
it now has no `step-fields` entry at all, the same as the unbuilt
Docker/Terminal/Slack types, just still marked `implemented: true` in
`STEP_TYPES`.

## Edit affordance: pencil-on-hover, not a permanent chevron

A step row's right-side icon was changed from an always-visible chevron
to a pencil shown only on hover (`opacity-0 group-hover:opacity-100`) —
but **only for editable rows**. Static, read-only detail rows (mock
workspaces, or any type with nothing editable) keep the original
always-visible rotating chevron: swapping that one too would have
falsely implied those rows were editable when they're not. The fork is
explicit (`Fields` truthy vs. not) in `TimelineStep.tsx`, not a single
shared icon choice.

## Testing

`lib/replace-step-params.ts` is pure and fully tested (target-index-only
replacement, reference equality on untouched entries, no mutation of the
input). `Detail.tsx`/`TimelineStep.tsx` themselves are not unit-tested,
consistent with this app's established no-DOM-test-infra precedent —
verified instead live, via Playwright driving the real built app: Save
stays hidden until an edit exists; a save persists (confirmed via
collapse/re-expand showing the real updated summary, not just local draft
state); Cancel reverts cleanly; a read-only mock workspace never shows
the editable UI at all.
