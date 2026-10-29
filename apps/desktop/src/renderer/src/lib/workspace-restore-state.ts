import type { LeftOpenEntry, StepResult } from '@workspace-launcher/shared';
import { getRestoreResultCounts } from './restore-result-treatment';

/**
 * Everything about a workspace's last Restore/Switch/Close that needs
 * to survive navigating away from it and back — lifted out of
 * Detail.tsx's own local state (which used to hold all of this, but
 * gets wiped on every workspace switch since App.tsx remounts Detail
 * via `key={workspace.id}`) into a per-workspace-id map owned by
 * App.tsx instead. Deliberately session-only: App.tsx never persists
 * this to disk, so a fresh app launch starts every workspace back at
 * `DEFAULT_RESTORE_STATE` — see this feature's own design notes on why
 * a restore result surviving a full quit is more misleading than
 * useful (it describes a machine state — Docker up, terminals running
 * — that's almost certainly no longer true by the next launch).
 *
 * `stepIdsAtRestore` is a parallel snapshot of each step's stable id
 * (WorkspaceStep.id), taken when `restoreResults` was recorded — so a
 * result is always shown against the step it was actually about, even
 * after steps were added, removed or reordered since. A step added
 * after the restore has no result; a removed step's result is dropped
 * (see resultsForSteps).
 */
export interface WorkspaceRestoreState {
  isRestoring: boolean;
  isSwitching: boolean;
  isClosing: boolean;
  restoreResults: StepResult[] | null;
  restoredAt: number | null;
  stepIdsAtRestore: string[] | null;
  activityLog: { closed: string[]; leftOpen: LeftOpenEntry[] } | null;
  retryingIndex: number | null;
}

/** Module-level, not an inline literal per call — every workspace that
 * has never had any restore activity this session shares this exact
 * reference, so nothing downstream churns re-deriving an equivalent
 * object on every lookup. */
export const DEFAULT_RESTORE_STATE: WorkspaceRestoreState = {
  isRestoring: false,
  isSwitching: false,
  isClosing: false,
  restoreResults: null,
  restoredAt: null,
  stepIdsAtRestore: null,
  activityLog: null,
  retryingIndex: null,
};

export type WorkspaceRestoreOutcome = 'success' | 'partial' | 'failed' | 'none';

/**
 * The sidebar's per-row status dot — collapses a workspace's last
 * restore down to four states. `'partial'` (at least one real success
 * AND at least one real failure) is its own state, not folded into
 * `'failed'` — a workspace where only one of three steps broke must
 * not render identically to one where every step broke; a user with
 * several workspaces glancing down the sidebar needs to tell "needs a
 * look" apart from "basically fine" without opening each one. `'none'`
 * covers both "never restored" and "restored but nothing really
 * succeeded or failed" (all-skipped, or an empty array) — deliberately
 * NOT folded into `'success'`: a workspace where nothing actually
 * succeeded must not show the same green dot as one where something
 * did (a real bug caught in review, before `'partial'` existed).
 */
export function getWorkspaceRestoreOutcome(
  state: WorkspaceRestoreState | undefined,
): WorkspaceRestoreOutcome {
  const results = state?.restoreResults;
  if (!results) return 'none';
  const { successCount, failureCount } = getRestoreResultCounts(results);
  if (successCount > 0 && failureCount > 0) return 'partial';
  if (failureCount > 0) return 'failed';
  if (successCount > 0) return 'success';
  return 'none';
}

/**
 * Each of the workspace's CURRENT steps paired with its result from the
 * last restore, by step id — steps without one (added since) are left
 * out, as are results for steps removed since. What the overview strip
 * and its counts show, so a deleted step never leaves a stray bar.
 */
export function resultsForSteps<T extends { id: string }>(
  state: Pick<WorkspaceRestoreState, 'restoreResults' | 'stepIdsAtRestore'>,
  steps: readonly T[],
): { step: T; result: StepResult; index: number }[] {
  const { restoreResults, stepIdsAtRestore } = state;
  if (!restoreResults || !stepIdsAtRestore) return [];
  return steps.flatMap((step) => {
    const index = stepIdsAtRestore.indexOf(step.id);
    const result = index === -1 ? undefined : restoreResults[index];
    return result ? [{ step, result, index }] : [];
  });
}
