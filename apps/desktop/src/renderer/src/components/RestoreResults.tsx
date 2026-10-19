import type { StepResult } from '@workspace-launcher/shared';
import { Icon } from '../icons';
import { ErrorCode } from './ErrorCode';

interface RestoreResultsProps {
  results: StepResult[];
  onRetryStep: (index: number) => void;
  /** Index of the step currently being retried, or null when none is —
   * disables every Retry button while set, so a second retry can't fire
   * while one is still in flight. */
  retryingIndex: number | null;
  /** True while a Switch/Close is in flight — these can replace or
   * discard `results` out from under a retry, so Retry must be
   * unavailable then too, not just while another retry is running. */
  disabled?: boolean;
  onShowErrorCode: (code: string) => void;
}

/**
 * Per-step success/fail feedback after clicking "Restore workspace" —
 * the minimal real version of docs/build-shell.md's "Show per-step
 * status (success/fail)", now with a Retry button per failed step.
 */
export function RestoreResults({
  results,
  onRetryStep,
  retryingIndex,
  disabled = false,
  onShowErrorCode,
}: RestoreResultsProps): JSX.Element {
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
          <ErrorCode message={result.message} code={result.code} onLearnMore={onShowErrorCode} />
          {!result.success && (
            <button
              type="button"
              disabled={retryingIndex !== null || disabled}
              className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border-strong px-2 text-[11px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                onRetryStep(i);
              }}
            >
              <Icon name="refresh" size={11} />
              {retryingIndex === i ? 'Retrying…' : 'Retry'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
