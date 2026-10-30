// electron-store is pinned to ^8.x in package.json deliberately — v9+
// is pure ESM ("type": "module"), but this main process bundle builds
// as CommonJS, so `require('electron-store')` fails at runtime
// (ERR_REQUIRE_ESM) on anything newer. Don't bump this past 8.x
// without also changing the main process's build output to ESM.
import Store from 'electron-store';
import {
  TERMINAL_COMMAND_POLL_TIMEOUT_MS,
  TERMINAL_SCRIPT_START_TIMEOUT_MS,
} from '../platform/macos/launcher';

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
 * Absolute floor for the adaptive timeout, regardless of how fast a
 * tool's recent runs were. Without this, a consistently-fast tool
 * (e.g. one that always completes in a few ms) converges on a
 * single-digit-millisecond timeout — small enough that ordinary
 * scheduling jitter (a GC pause, momentary disk contention) makes an
 * otherwise-fine run look "hung" and fail it.
 */
export const MIN_ADAPTIVE_TIMEOUT_MS = 5000;

/**
 * Docker's own, far higher floor — its real worst case dwarfs every
 * other tool type's. Confirmed via a real false-timeout: a cold Docker
 * Desktop launch alone can take up to ~90s (ensureDockerDaemonRunning,
 * docker-tool.ts), on top of which Tilt's own terminal-detection
 * window adds up to ~10.5s more (macos/launcher.ts's two-phase
 * detection — it has to wait for the terminal to actually start before
 * it can begin checking for a failure) and Compose's own internal
 * command timeout adds up to 130s more (runEngineCommand,
 * docker-tool.ts) — a genuine ~220s worst case for Compose alone. 4
 * minutes leaves real buffer above that rather than cutting it at the
 * line.
 */
export const DOCKER_MIN_ADAPTIVE_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * A terminal's own worst case, per terminal in the step: opening one
 * waits up to TERMINAL_SCRIPT_START_TIMEOUT_MS for Terminal to start
 * its script, then TERMINAL_COMMAND_POLL_TIMEOUT_MS for an early
 * failure (macos/launcher.ts) — plus a second of margin. A tighter
 * timeout cut real opens off: a usual ~4s open learned a ~5-6s limit,
 * a slower Terminal start then "timed out" with its window open but
 * never recorded (found 2026-10-30).
 */
export const TERMINAL_OPEN_WORST_CASE_MS =
  TERMINAL_SCRIPT_START_TIMEOUT_MS + TERMINAL_COMMAND_POLL_TIMEOUT_MS + 1000;

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
 * The key timing samples are stored/looked up under — usually just the
 * tool type, but Docker's compose and tilt engines get their OWN
 * separate keys. They have fundamentally different speed profiles:
 * Compose is a direct, usually-fast execFile call, while Tilt always
 * takes at least ~8-10.5s by design (openTerminal's own two-phase
 * detection has to wait for the terminal to actually start before it
 * can even begin checking for a failure). Blending them into one
 * 'docker' average silently skews the adaptive timeout toward whichever
 * engine happens to dominate recent runs — confirmed as a real bug,
 * not theoretical: Compose's fast completions pulled the learned
 * 'docker' timeout down to ~6s, which then falsely killed a genuinely
 * successful Tilt deployment that was still well within its own
 * normal latency.
 */
function timingHistoryKey(type: string, params: Record<string, unknown>): string {
  if (type === 'docker' && (params['engine'] === 'tilt' || params['engine'] === 'compose')) {
    return `${type}:${params['engine']}`;
  }
  return type;
}

function minAdaptiveTimeoutMsFor(key: string, params: Record<string, unknown>): number {
  if (key.startsWith('docker:')) return DOCKER_MIN_ADAPTIVE_TIMEOUT_MS;
  if (key === 'terminal') {
    const terminals = Array.isArray(params['terminals']) ? params['terminals'].length : 1;
    return Math.max(1, terminals) * TERMINAL_OPEN_WORST_CASE_MS;
  }
  return MIN_ADAPTIVE_TIMEOUT_MS;
}

/**
 * The timeout to use for a step of this tool type: the generous
 * DEFAULT_STEP_TIMEOUT_MS until MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT
 * successful runs have been recorded for it, then
 * average(recent successful durations) * TIMEOUT_BUFFER_MULTIPLIER —
 * floored per `minAdaptiveTimeoutMsFor` so a tool type with a known-high
 * worst case (Docker) can never adapt down below it, however fast its
 * own recent runs happened to be.
 */
export function getStepTimeoutMs(type: string, params: Record<string, unknown>): number {
  const key = timingHistoryKey(type, params);
  const samples = historyStore.get('durationsByToolType')[key] ?? [];
  if (samples.length < MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT) {
    return DEFAULT_STEP_TIMEOUT_MS;
  }
  const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  return Math.max(
    minAdaptiveTimeoutMsFor(key, params),
    Math.round(average * TIMEOUT_BUFFER_MULTIPLIER),
  );
}

/**
 * Records a successful step's real duration for future timeout
 * estimates. Only call this for steps that actually succeeded — a
 * failed or timed-out run's duration isn't representative of normal
 * operation time and would corrupt the average downward.
 */
export function recordSuccessfulStepDuration(
  type: string,
  params: Record<string, unknown>,
  durationMs: number,
): void {
  const key = timingHistoryKey(type, params);
  const all = historyStore.get('durationsByToolType');
  const samples = [...(all[key] ?? []), durationMs].slice(-MAX_SAMPLES_PER_TOOL);
  historyStore.set('durationsByToolType', { ...all, [key]: samples });
}

/**
 * The typical (average) recorded duration for a tool type, for DISPLAY
 * purposes — distinct from getStepTimeoutMs, which estimates a TIMEOUT
 * (a different fallback — a 2-hour ceiling, not "no data" — and a
 * *1.5 safety buffer that would be misleading framed as "how long this
 * usually takes"). Returns undefined below MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT
 * samples, the same threshold getStepTimeoutMs itself treats as "not
 * enough data" — and also if any recorded sample is non-finite (a
 * corrupted store value), rather than letting NaN/Infinity silently
 * propagate into a displayed duration.
 */
export function getTypicalStepDurationMs(
  type: string,
  params: Record<string, unknown>,
): number | undefined {
  const key = timingHistoryKey(type, params);
  const samples = historyStore.get('durationsByToolType')[key] ?? [];
  if (samples.length < MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT) {
    return undefined;
  }
  if (!samples.every((ms) => Number.isFinite(ms))) {
    return undefined;
  }
  return Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length);
}
