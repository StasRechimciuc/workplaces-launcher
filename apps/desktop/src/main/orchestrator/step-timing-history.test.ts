import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  DOCKER_MIN_ADAPTIVE_TIMEOUT_MS,
  getStepTimeoutMs,
  getTypicalStepDurationMs,
  MIN_ADAPTIVE_TIMEOUT_MS,
  recordSuccessfulStepDuration,
  TERMINAL_OPEN_WORST_CASE_MS,
} from './step-timing-history';

// electron-store needs a real Electron `app` to resolve its storage
// path — unavailable under Vitest. Faked with a plain in-memory object
// so this test exercises our own averaging/threshold/window logic, not
// electron-store's (already well-tested elsewhere) persistence. vi.mock
// calls are hoisted above imports by Vitest, so the static import above
// still resolves against this fake.
vi.mock('electron-store', () => {
  class FakeStore<T extends object> {
    private data: T;
    constructor(options: { defaults: T }) {
      this.data = { ...options.defaults };
    }
    get<K extends keyof T>(key: K): T[K] {
      return this.data[key];
    }
    set<K extends keyof T>(key: K, value: T[K]): void {
      this.data[key] = value;
    }
  }
  return { default: FakeStore };
});

const NO_PARAMS = {};

describe('step-timing-history', () => {
  it('returns the generous default for a tool type with no history', () => {
    expect(getStepTimeoutMs('never-seen', NO_PARAMS)).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('still returns the default below the minimum sample threshold (3)', () => {
    recordSuccessfulStepDuration('vscode', NO_PARAMS, 1000);
    recordSuccessfulStepDuration('vscode', NO_PARAMS, 1000);
    expect(getStepTimeoutMs('vscode', NO_PARAMS)).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('switches to average * 1.5 once the threshold is met', () => {
    recordSuccessfulStepDuration('terminal', NO_PARAMS, 10000);
    recordSuccessfulStepDuration('terminal', NO_PARAMS, 10000);
    recordSuccessfulStepDuration('terminal', NO_PARAMS, 10000);
    // average 10000 * 1.5 buffer = 15000 (well above the floor, so the
    // real multiplier logic — not the floor — is what this asserts).
    expect(getStepTimeoutMs('terminal', NO_PARAMS)).toBe(15000);
  });

  it('never cuts a terminal step off before its own terminals could have opened', () => {
    // 'terminal' has a 15s learned limit by now (above); two terminals
    // can legitimately take longer, so the floor wins.
    const two = { terminals: [{}, {}] };
    expect(getStepTimeoutMs('terminal', two)).toBe(2 * TERMINAL_OPEN_WORST_CASE_MS);
    expect(TERMINAL_OPEN_WORST_CASE_MS).toBe(11_500);
  });

  it('keeps only the most recent 10 samples, dropping older ones', () => {
    recordSuccessfulStepDuration('chrome', NO_PARAMS, 1000); // will be dropped
    for (let i = 0; i < 10; i++) {
      recordSuccessfulStepDuration('chrome', NO_PARAMS, 10000);
    }
    // If the dropped 1000ms sample were still counted (11 samples),
    // the average — and therefore the timeout — would be lower than
    // this.
    expect(getStepTimeoutMs('chrome', NO_PARAMS)).toBe(15000);
  });

  it('tracks separate history per tool type', () => {
    recordSuccessfulStepDuration('slack', NO_PARAMS, 4000);
    recordSuccessfulStepDuration('slack', NO_PARAMS, 4000);
    recordSuccessfulStepDuration('slack', NO_PARAMS, 4000);
    recordSuccessfulStepDuration('spotify', NO_PARAMS, 9000);
    recordSuccessfulStepDuration('spotify', NO_PARAMS, 9000);
    recordSuccessfulStepDuration('spotify', NO_PARAMS, 9000);

    expect(getStepTimeoutMs('slack', NO_PARAMS)).toBe(6000);
    expect(getStepTimeoutMs('spotify', NO_PARAMS)).toBe(13500);
  });

  it('never returns below the minimum floor, even for a consistently very fast tool', () => {
    recordSuccessfulStepDuration('instant-tool', NO_PARAMS, 10);
    recordSuccessfulStepDuration('instant-tool', NO_PARAMS, 10);
    recordSuccessfulStepDuration('instant-tool', NO_PARAMS, 10);
    // Raw average * 1.5 would be 15ms — far too tight to survive
    // ordinary scheduling jitter. The floor must win.
    expect(getStepTimeoutMs('instant-tool', NO_PARAMS)).toBe(MIN_ADAPTIVE_TIMEOUT_MS);
  });

  describe('Docker: compose/tilt are split, with a much higher floor', () => {
    // Only 'compose'/'tilt' ever trigger Docker-specific keying (see
    // timingHistoryKey), so there are exactly two real sub-keys to test
    // against — these tests build on each other sequentially within
    // this describe block (declaration order), not independent fakes
    // the way every other test in this file uses a unique type string.

    it('(regression) keeps compose and tilt history completely separate, not blended into one "docker" bucket, and both floor to DOCKER_MIN_ADAPTIVE_TIMEOUT_MS at realistic durations', () => {
      // The actual bug this fixes: Compose's fast completions used to
      // drag the SHARED 'docker' timeout down low enough to falsely
      // kill a genuinely successful, merely-slower Tilt run.
      recordSuccessfulStepDuration('docker', { engine: 'compose' }, 1000);
      recordSuccessfulStepDuration('docker', { engine: 'compose' }, 1000);
      recordSuccessfulStepDuration('docker', { engine: 'compose' }, 1000);
      recordSuccessfulStepDuration('docker', { engine: 'tilt' }, 9000);
      recordSuccessfulStepDuration('docker', { engine: 'tilt' }, 9000);
      recordSuccessfulStepDuration('docker', { engine: 'tilt' }, 9000);

      // Confirmed via the raw (unfloored) average that the two never mix:
      expect(getTypicalStepDurationMs('docker', { engine: 'compose' })).toBe(1000);
      expect(getTypicalStepDurationMs('docker', { engine: 'tilt' })).toBe(9000);
      // Both still floor to the same Docker-specific minimum — real
      // Docker/Tilt durations are nowhere near the ~4 minute floor on
      // their own; it exists for the slow case (a cold Docker Desktop
      // launch), not the common one.
      expect(getStepTimeoutMs('docker', { engine: 'compose' })).toBe(
        DOCKER_MIN_ADAPTIVE_TIMEOUT_MS,
      );
      expect(getStepTimeoutMs('docker', { engine: 'tilt' })).toBe(DOCKER_MIN_ADAPTIVE_TIMEOUT_MS);
      expect(DOCKER_MIN_ADAPTIVE_TIMEOUT_MS).toBeGreaterThan(MIN_ADAPTIVE_TIMEOUT_MS);
    });

    it('lets the real multiplier win once history is slow enough to exceed even the Docker-specific floor', () => {
      // Builds on the previous test's 'docker:tilt' history — 10 new,
      // much larger samples fully displace the old 3 (MAX_SAMPLES_PER_TOOL
      // caps the window at 10), so the average below is exact, not an
      // approximation.
      for (let i = 0; i < 10; i++) {
        recordSuccessfulStepDuration('docker', { engine: 'tilt' }, 200_000);
      }
      // average 200000 * 1.5 = 300000, comfortably above the 240000
      // floor — the real multiplier logic, not the floor, decides here.
      expect(getStepTimeoutMs('docker', { engine: 'tilt' })).toBe(300_000);
    });

    it('falls back to the plain "docker" key (and the generic floor) when engine is missing/invalid — defensive, not expected in real use', () => {
      recordSuccessfulStepDuration('docker', {}, 10);
      recordSuccessfulStepDuration('docker', {}, 10);
      recordSuccessfulStepDuration('docker', {}, 10);
      expect(getStepTimeoutMs('docker', {})).toBe(MIN_ADAPTIVE_TIMEOUT_MS);
    });

    it('a non-docker tool type is never affected by the Docker-specific floor', () => {
      recordSuccessfulStepDuration('vscode', { engine: 'tilt' }, 10);
      recordSuccessfulStepDuration('vscode', { engine: 'tilt' }, 10);
      recordSuccessfulStepDuration('vscode', { engine: 'tilt' }, 10);
      // 'engine' on a non-docker type's params is meaningless and must
      // not accidentally trigger docker-only keying/flooring.
      expect(getStepTimeoutMs('vscode', { engine: 'tilt' })).toBe(MIN_ADAPTIVE_TIMEOUT_MS);
    });
  });

  describe('getTypicalStepDurationMs', () => {
    it('returns undefined for a tool type with no history', () => {
      expect(getTypicalStepDurationMs('display-never-seen', NO_PARAMS)).toBeUndefined();
    });

    it('returns undefined below the minimum sample threshold (3)', () => {
      recordSuccessfulStepDuration('display-vscode', NO_PARAMS, 3000);
      recordSuccessfulStepDuration('display-vscode', NO_PARAMS, 3000);
      expect(getTypicalStepDurationMs('display-vscode', NO_PARAMS)).toBeUndefined();
    });

    it('returns the rounded average once the threshold is met', () => {
      recordSuccessfulStepDuration('display-chrome', NO_PARAMS, 1000);
      recordSuccessfulStepDuration('display-chrome', NO_PARAMS, 2000);
      recordSuccessfulStepDuration('display-chrome', NO_PARAMS, 3000);
      expect(getTypicalStepDurationMs('display-chrome', NO_PARAMS)).toBe(2000);
    });

    it('keeps only the most recent 10 samples, dropping older ones', () => {
      recordSuccessfulStepDuration('display-spotify', NO_PARAMS, 1000); // will be dropped
      for (let i = 0; i < 10; i++) {
        recordSuccessfulStepDuration('display-spotify', NO_PARAMS, 5000);
      }
      // If the dropped 1000ms sample still counted (11 samples), the
      // average would be lower than this.
      expect(getTypicalStepDurationMs('display-spotify', NO_PARAMS)).toBe(5000);
    });

    it('returns undefined, not NaN, if a stored sample is non-finite', () => {
      recordSuccessfulStepDuration('display-corrupted', NO_PARAMS, 1000);
      recordSuccessfulStepDuration('display-corrupted', NO_PARAMS, 2000);
      recordSuccessfulStepDuration('display-corrupted', NO_PARAMS, NaN);
      expect(getTypicalStepDurationMs('display-corrupted', NO_PARAMS)).toBeUndefined();
    });

    it('is a separate reading from getStepTimeoutMs — no 1.5x buffer applied', () => {
      recordSuccessfulStepDuration('display-vs-timeout', NO_PARAMS, 10000);
      recordSuccessfulStepDuration('display-vs-timeout', NO_PARAMS, 10000);
      recordSuccessfulStepDuration('display-vs-timeout', NO_PARAMS, 10000);
      expect(getTypicalStepDurationMs('display-vs-timeout', NO_PARAMS)).toBe(10000);
      expect(getStepTimeoutMs('display-vs-timeout', NO_PARAMS)).toBe(15000);
    });

    it('blends two different generic "app"-type instances into one bucket — a known, accepted limitation, not a bug', () => {
      // The generic 'app' step type is keyed by the bare step type
      // string, same as every other non-Docker type — there's no
      // per-derived-name bucketing. This test documents the resulting
      // behavior rather than papering over it: a Figma-launch sample
      // and an unrelated Slack-launch sample both land in the one
      // 'app' bucket and get blended together.
      recordSuccessfulStepDuration('app', NO_PARAMS, 2000); // e.g. Figma
      recordSuccessfulStepDuration('app', NO_PARAMS, 2000);
      recordSuccessfulStepDuration('app', NO_PARAMS, 8000); // e.g. Slack, much slower
      expect(getTypicalStepDurationMs('app', NO_PARAMS)).toBe(4000);
    });
  });
});
