import { Icon } from '../icons';

interface ErrorCodeProps {
  message: string;
  /** Absent means this message predates the error-code system, or is
   * one of the handful of internal-only guards that deliberately never
   * gets one (handlers.ts's malformed-payload throws) — falls back to
   * plain text, same as before this feature existed. */
  code?: string | undefined;
  onLearnMore: (code: string) => void;
}

/**
 * Replaces every bare `<span>{message}</span>` error render in this app
 * (RestoreResults, Detail, TimelineStep, WorkspaceFormModal) with one
 * shared presentational component — the message, plus (when a code is
 * present) a small badge and a "Learn more" link into ErrorsModal.
 */
export function ErrorCode({ message, code, onLearnMore }: ErrorCodeProps): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{message}</span>
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
  );
}
