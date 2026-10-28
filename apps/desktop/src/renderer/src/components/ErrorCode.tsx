import { useState } from 'react';
import { getErrorCode } from '@workspace-launcher/shared';
import { Icon } from '../icons';
import { cn } from '../lib/utils';

interface ErrorCodeProps {
  message: string;
  /** Absent means this message predates the error-code system, or is
   * one of the handful of internal-only guards that deliberately never
   * gets one (handlers.ts's malformed-payload throws) — falls back to
   * plain text, same as before this feature existed. */
  code?: string | undefined;
  onLearnMore: (code: string) => void;
  /**
   * Suppresses the "Show technical detail" toggle even when the code
   * has a `headline` — for a caller that's ALSO rendering something
   * more specific right below this (TimelineStep.tsx's
   * TerminalBreakdown, for a terminal-shaped failure: the real
   * command, exit code, and captured output). `message` there is just
   * a prose restatement of exactly those same facts, less precisely —
   * showing both was confirmed redundant, not two different levels of
   * detail. Has no effect when there's no `headline` (message is
   * already the only thing shown, nothing to suppress).
   */
  hideTechnicalDetail?: boolean;
}

/**
 * Replaces every bare `<span>{message}</span>` error render in this app
 * (RestoreResults, Detail, TimelineStep, WorkspaceFormModal) with one
 * shared presentational component — the message, plus (when a code is
 * present) a small badge and a "Learn more" link into ErrorsModal.
 *
 * When the resolved code has a `headline` (error-codes.ts — a staged
 * rollout, not every code yet), that plain-language text is what's
 * actually shown here; the raw per-instance `message` is demoted to a
 * collapsed "Show technical detail" toggle on the same row, instead of
 * being the only thing a non-debugging user sees. A code with no
 * `headline` yet falls back to exactly the old behavior (message shown
 * directly) — this is additive, not a breaking change for the rest of
 * the catalog. "Learn more" keeps opening ErrorsModal's static catalog
 * entry unchanged — that page was already designed to never hold
 * per-instance/dynamic content (see its own doc comment), so the raw
 * detail belongs here, inline, not threaded into that modal.
 */
export function ErrorCode({
  message,
  code,
  onLearnMore,
  hideTechnicalDetail,
}: ErrorCodeProps): JSX.Element {
  const [showDetail, setShowDetail] = useState(false);
  const headline = code ? getErrorCode(code)?.headline : undefined;
  const showToggle = headline && !hideTechnicalDetail;

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{headline ?? message}</span>
        {code && (
          <>
            <span className="rounded-sm border border-danger px-1 font-mono text-[10.5px] text-danger">
              {code}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-[11px] text-text-faint underline-offset-2 hover:text-text-muted hover:underline"
              onClick={() => onLearnMore(code)}
            >
              Learn more about this error
              <Icon name="externalLink" size={10} />
            </button>
          </>
        )}
      </span>
      {showToggle && (
        <>
          <button
            type="button"
            className="inline-flex w-fit items-center gap-0.5 text-[11px] text-text-faint hover:text-text-muted"
            onClick={() => setShowDetail((v) => !v)}
          >
            <span
              className={cn(
                'flex items-center transition-transform duration-140',
                showDetail && 'rotate-90',
              )}
            >
              <Icon name="chevronRight" size={11} />
            </span>
            {showDetail ? 'Hide technical detail' : 'Show technical detail'}
          </button>
          {showDetail && (
            <pre className="w-full overflow-x-auto rounded-sm bg-bg-hover px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-text-muted">
              {message}
            </pre>
          )}
        </>
      )}
    </span>
  );
}
