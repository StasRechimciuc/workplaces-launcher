import type { StepResult } from '@workspace-launcher/shared';
import { Icon } from '../icons';

interface RestoreResultsProps {
  results: StepResult[];
}

/**
 * Per-step success/fail feedback after clicking "Restore workspace" —
 * the minimal real version of docs/build-shell.md's "Show per-step
 * status (success/fail)". A fuller treatment (live status inline per
 * timeline row as each step runs, a retry button per failed step) is
 * its own, separate Tier 1 item — this proves the result is real and
 * visible, not silence after the click.
 */
export function RestoreResults({ results }: RestoreResultsProps): JSX.Element {
  const failureCount = results.filter((r) => !r.success).length;

  return (
    <div className="mb-5.5 flex flex-col gap-1.5">
      <p className="mb-4.5 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
        {failureCount === 0
          ? `Restored — ${results.length} of ${results.length} steps succeeded`
          : `${results.length - failureCount} of ${results.length} steps succeeded`}
      </p>
      {results.map((result, i) => (
        <div
          className="flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted"
          key={i}
        >
          <Icon
            name={result.success ? 'check' : 'x'}
            size={13}
            className={result.success ? 'text-success' : 'text-danger'}
          />
          <span>{result.message}</span>
        </div>
      ))}
    </div>
  );
}
