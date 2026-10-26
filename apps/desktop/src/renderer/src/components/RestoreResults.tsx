import type { StepResult } from '@workspace-launcher/shared';
import type { WorkspaceToolStepDisplay } from '../../../preload';
import { formatPreciseDuration } from '@workspace-launcher/shared';
import { getRestoreResultCounts } from '../lib/restore-result-treatment';
import { formatRelativeTime } from '../lib/relative-time';
import { RestoreResultsLegend } from './RestoreResultsLegend';

interface RestoreResultsProps {
  results: StepResult[];
  tools: WorkspaceToolStepDisplay[];
  /** When the restore that produced `results` finished — drives the
   * header's "restored N ago" clause. */
  restoredAt: number;
}

/**
 * The restore-results HEADER + overview strip — "N of M steps
 * succeeded," a precise real total duration, "restored N ago," and the
 * per-step legend strip. Per-row outcome display itself lives in
 * TimelineStep now (this component used to own that too, via
 * RestoreResultRow — merged into the single step list so a step's
 * "plan" and "result" views are the same row, not two separate lists;
 * see this feature's own design notes). "Skipped" doesn't count toward
 * `failureCount`, and doesn't get silently counted as a success either
 * — the "N of M succeeded" number is `successCount` directly, not
 * `results.length - failureCount`, so a skipped step never inflates it.
 *
 * "Restored N ago" is computed from `Date.now()` at render time, not a
 * live ticking clock — it goes stale only if the user sits looking at
 * this exact screen with zero other state changes for a while, which
 * a periodic re-render timer would fix at the cost of real complexity
 * (interval setup/teardown) for a cosmetic freshness guarantee. A
 * deliberate simplification, not an oversight.
 */
export function RestoreResults({ results, tools, restoredAt }: RestoreResultsProps): JSX.Element {
  const { successCount, failureCount } = getRestoreResultCounts(results);
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  return (
    <div className="mb-5.5 flex flex-col gap-1.5">
      <p className="mb-4.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
        <span>
          {failureCount === 0
            ? `Restored — ${successCount} of ${results.length} steps succeeded`
            : `${successCount} of ${results.length} steps succeeded`}
        </span>
        <span className="font-normal normal-case tracking-normal text-text-faint">
          · {formatPreciseDuration(totalMs)} · restored {formatRelativeTime(restoredAt, Date.now())}
        </span>
      </p>
      <RestoreResultsLegend results={results} tools={tools} />
    </div>
  );
}
