# Retry Per Failed Step

Letting the user retry a single failed step after a restore, instead of
re-running the whole workspace. Source of truth is `retryStep`
(`orchestrator/orchestrator.ts`) and `retryWorkspaceStep`
(`ipc/handlers.ts`); this doc explains the design decisions behind the
narrow scope.

## What it does

After a restore finishes with one or more failed steps, each failed row
in `RestoreResults.tsx` gets a Retry button. Clicking it re-runs just
that step and replaces its row's result **in place** — no duplicate
entries, no change to the other steps' already-shown results.

## Settled before building (three real open questions, not assumptions)

1. **Do steps depend on each other, so a retry might need to cascade?**
   Checked directly against the code, not assumed: `runWorkspace`'s loop
   only ever passes each step its own validated params plus a static
   `workspaceId` — a step's result never feeds into the next step's
   execution, and no tool's `run()` reads shared state another step might
   have set. No Docker tool exists yet either, so there's no "setup step"
   dependency to worry about. **Steps are fully independent** — retrying
   step N never needs to touch anything after it.
2. **Replace in place, or append a new entry with a timestamp?**
   Founder: replace in place — matches "fix this step," no growing list
   of stale failures to scroll past.
3. **Reachable mid-restore, or only after the whole run finishes?**
   Founder: only after finishing — simpler state, matches how results
   are already shown post-restore.

## Mechanism

`runStep` (per-step execution: tool lookup, zod validation, timeout,
duration recording, never throws) already existed, module-private to
`orchestrator.ts`, called internally by `runWorkspace`'s loop — it was
already exactly the right single-step execution primitive, just not
exposed. The new `retryStep(config, stepIndex)` is a thin exported
sibling to `runWorkspace` that delegates to it, with an out-of-range
index reported as a failed `StepResult` rather than thrown — consistent
with that module's existing "always resolves a `StepResult`, never
rejects" contract.

`handlers.ts`'s `restoreWorkspace` originally inlined its real-vs-mock
workspace lookup; that lookup was factored out into a shared
`resolveWorkspaceConfig(workspaceId)` helper, now used by both
`restoreWorkspace` and the new `retryWorkspaceStep` — one implementation
of "find this workspace, real config first, mock data as fallback," not
two.

## Why retry skips the progress/focus machinery

`workspaces:restore`'s IPC handler starts an always-on-top focus session
and pushes a live "Step X of N" progress event per step — both exist to
keep the user oriented through a multi-step run that can take real time.
`workspaces:retryStep` deliberately has neither: per the settled design
above, retry only ever fires once a restore has already finished, so
there's no multi-step run in progress to keep the user oriented through.
A single retried step either succeeds or fails quickly; the row's own
"Retrying…" label is enough feedback.

## UI

`RestoreResults.tsx` disables **every** Retry button while any one retry
is in flight (not just the row being retried) — avoids two concurrent
retries racing on the same `setRestoreResults` state update and launching
two app-opens simultaneously. `Detail.tsx`'s `retryingIndex` is reset
whenever a fresh full restore starts, so a retry that resolves after a
*new* restore has already begun can't leave every Retry button on the new
results wrongly disabled forever.

An unexpected IPC-level failure (not the normal tool-level
`{success:false}` path — e.g. the workspace vanished mid-session) is
turned into a synthetic failed `StepResult` for that row rather than a
separate error banner: one consistent "replace in place" outcome for
every retry attempt, not two different failure UI patterns depending on
where the failure happened.

## Testing

`orchestrator.test.ts`'s `retryStep` suite: re-runs exactly the step at
the given index (not a neighboring one), reports a failed result (not a
throw) for an out-of-range or negative index, surfaces a genuinely
failing retried step the same way a normal run would.
`handlers.test.ts`'s `retryWorkspaceStep` suite covers both the real and
mock-workspace lookup paths, bad input shapes, and an out-of-range index
on a real workspace. Live-verified via Playwright driving the real built
app against an actual partial restore failure: Retry buttons appear only
on genuinely failed rows, never succeeded ones; retrying replaces that
row in place with no duplication or row-count drift.
