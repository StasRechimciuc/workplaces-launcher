/**
 * Formats a millisecond duration as a short, human-readable string for
 * display — "3s", "1m 20s", "45m". Pure, no I/O. Rounds to the nearest
 * whole second (sub-second precision is never useful for a launch-time
 * display), but floors any genuinely positive value to "1s" rather than
 * letting it round down to "0s" — a real, non-zero measurement must
 * never look identical to the placeholder this exists to replace.
 * Non-finite input (e.g. a corrupted stored sample) returns "0s" rather
 * than propagating a "NaNs"/"Infinitys" string — callers that read from
 * persisted data should still prefer filtering non-finite samples
 * upstream (see step-timing-history.ts's getTypicalStepDurationMs)
 * rather than relying on this fallback.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '0s';

  const totalSeconds = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
