// electron-store is pinned to ^8.x in package.json deliberately — v9+
// is pure ESM ("type": "module"), but this main process bundle builds
// as CommonJS, so `require('electron-store')` fails at runtime
// (ERR_REQUIRE_ESM) on anything newer. Don't bump this past 8.x
// without also changing the main process's build output to ESM.
import Store from 'electron-store';

interface StepTimingHistoryShape {
  /** Tool type -> most recent successful run durations (ms), oldest first. */
  durationsByToolType: Record<string, number[]>;
}

/** Only the last N successful durations per tool type are kept, so the
 * estimate can adapt if a tool's typical run time changes over time
 * (more containers added, a bigger project) instead of being anchored
 * to a stale lifetime average. */
const MAX_SAMPLES_PER_TOOL = 10;

/** Below this many recorded successful runs for a tool type, there
 * isn't enough real data to trust an average — stay on the generous
 * default instead of computing a timeout from 1-2 samples. */
const MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT = 3;

/** Timeout = average(recent successful durations) * this, once there's
 * enough history. 1.5x: tight enough to catch a genuinely hung run,
 * generous enough to absorb normal variance (a cold cache, one extra
 * container) without false-timing-out a slow-but-fine run. */
const TIMEOUT_BUFFER_MULTIPLIER = 1.5;

/**
 * Generous first-run ceiling for any tool type with no history yet.
 * Real steps can legitimately take a long time (Docker/Tilt
 * cold-building several containers, a slow VPN-gated registry pull) —
 * this has to be big enough to never false-positive on a slow-but-fine
 * first run, at the cost of being a poor bound on a genuinely hung one
 * until real data exists to replace it.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

const historyStore = new Store<StepTimingHistoryShape>({
  name: 'step-timing-history',
  defaults: { durationsByToolType: {} },
});

/**
 * The timeout to use for a step of this tool type: the generous
 * DEFAULT_STEP_TIMEOUT_MS until MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT
 * successful runs have been recorded for it, then
 * average(recent successful durations) * TIMEOUT_BUFFER_MULTIPLIER.
 */
export function getStepTimeoutMs(toolType: string): number {
  const samples = historyStore.get('durationsByToolType')[toolType] ?? [];
  if (samples.length < MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT) {
    return DEFAULT_STEP_TIMEOUT_MS;
  }
  const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  return Math.round(average * TIMEOUT_BUFFER_MULTIPLIER);
}

/**
 * Records a successful step's real duration for future timeout
 * estimates. Only call this for steps that actually succeeded — a
 * failed or timed-out run's duration isn't representative of normal
 * operation time and would corrupt the average downward.
 */
export function recordSuccessfulStepDuration(toolType: string, durationMs: number): void {
  const all = historyStore.get('durationsByToolType');
  const samples = [...(all[toolType] ?? []), durationMs].slice(-MAX_SAMPLES_PER_TOOL);
  historyStore.set('durationsByToolType', { ...all, [toolType]: samples });
}
