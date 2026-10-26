import type { StepResult } from '@workspace-launcher/shared';
import { asTerminalFailureDetail, getErrorCode } from '@workspace-launcher/shared';

/**
 * Which of the restore-results UI's five visual treatments a step's
 * result maps to — pulled out as a pure function (see this project's
 * own "extract pure logic, leave the thin React wrapper untested"
 * convention — no React Testing Library here) so the actual branching
 * logic is unit-tested directly, not only indirectly through a
 * component render.
 *
 * - 'success': the step's own `success: true`.
 * - 'skipped': failed, but its error code is catalog-flagged
 *   `treatment: 'skipped'` (e.g. an unregistered tool type) — nothing
 *   to act on, not a real failure.
 * - 'not-started': a terminal/Tilt step whose entry (or every entry,
 *   for several) never got far enough to run any configured command —
 *   the terminal app itself failed to launch, or it opened but
 *   couldn't `cd` into the configured directory.
 * - 'started-then-failed': a terminal/Tilt step where at least one
 *   entry actually ran a command, and one of those commands failed.
 * - 'failed': anything else — a plain one-shot failure (an app
 *   couldn't launch, a Chrome tab failed to load, ...) with no
 *   terminal-shaped structured detail to show a sub-breakdown for.
 */
export type RestoreResultTreatment =
  'success' | 'skipped' | 'not-started' | 'started-then-failed' | 'failed';

export function getRestoreResultTreatment(result: StepResult): RestoreResultTreatment {
  if (result.success) return 'success';
  if (result.code && getErrorCode(result.code)?.treatment === 'skipped') return 'skipped';

  const detail = asTerminalFailureDetail(result.details);
  if (!detail) return 'failed';

  // Must check the commands' own status, not just "this entry had
  // commands and didn't fail to open" — an entry can open fine and
  // have every one of its commands succeed while a SIBLING entry in
  // the same step is what failed to open; that's still "nothing
  // actually failed to run," not "started, then failed."
  const anyCommandFailed = detail.entries.some((entry) =>
    entry.commands.some((command) => command.status === 'failed'),
  );
  return anyCommandFailed ? 'started-then-failed' : 'not-started';
}

/**
 * The "N of M steps succeeded" header's two counts — `successCount`
 * computed directly (not derived as `results.length - failureCount`),
 * so a 'skipped' result never gets implicitly counted as a success
 * just because it also isn't counted as a failure. A real bug this
 * fixes: the header previously claimed a skipped step had "succeeded."
 */
export function getRestoreResultCounts(results: StepResult[]): {
  successCount: number;
  failureCount: number;
} {
  let successCount = 0;
  let failureCount = 0;
  for (const result of results) {
    const treatment = getRestoreResultTreatment(result);
    if (treatment === 'success') successCount++;
    else if (treatment !== 'skipped') failureCount++;
  }
  return { successCount, failureCount };
}
