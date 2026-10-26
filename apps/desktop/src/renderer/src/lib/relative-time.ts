/**
 * "N ago" text for the restore-results header's "restored 2 min ago"
 * clause — coarse on purpose (minute granularity past the first
 * minute), since this is a passive, glanceable timestamp, not a
 * countdown anyone is watching tick. Pure function of `(now, then)`
 * rather than reading `Date.now()` itself, so it's trivially testable
 * and a caller can re-derive it on an interval without this function
 * needing any timer/state of its own.
 */
export function formatRelativeTime(thenMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - thenMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 60) return 'just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}
