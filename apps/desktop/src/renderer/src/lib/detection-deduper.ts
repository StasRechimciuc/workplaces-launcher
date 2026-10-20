/**
 * Pure, framework-agnostic guard for "start at most one in-flight
 * operation per key" — pulled out of useAppPathDetections.ts so the
 * actual dedupe behavior (the thing an adversarial review flagged as
 * having zero test backing) can be verified directly with Vitest,
 * without a React renderer. This project has no React
 * hook/component-testing infrastructure (@testing-library/react isn't
 * installed) and the established convention everywhere else is to
 * extract the pure logic and leave the thin React wrapper itself
 * untested (step-summaries.ts, resolve-app-path.ts, etc.) — same
 * pattern here, not a new one.
 */
export class DetectionDeduper<K> {
  private readonly inFlight = new Set<K>();

  /**
   * Returns true (and marks `key` in flight) only if `key` isn't
   * already in flight and `alreadyDone` is false — the caller should
   * start real work exactly when this returns true, and call
   * `finish(key)` once that work settles (success or failure).
   */
  shouldStart(key: K, alreadyDone: boolean): boolean {
    if (this.inFlight.has(key) || alreadyDone) {
      return false;
    }
    this.inFlight.add(key);
    return true;
  }

  finish(key: K): void {
    this.inFlight.delete(key);
  }

  reset(): void {
    this.inFlight.clear();
  }
}
