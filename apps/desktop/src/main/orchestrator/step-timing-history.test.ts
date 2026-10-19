import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
  getTypicalStepDurationMs,
  MIN_ADAPTIVE_TIMEOUT_MS,
  recordSuccessfulStepDuration,
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

describe('step-timing-history', () => {
  it('returns the generous default for a tool type with no history', () => {
    expect(getStepTimeoutMs('never-seen')).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('still returns the default below the minimum sample threshold (3)', () => {
    recordSuccessfulStepDuration('docker', 1000);
    recordSuccessfulStepDuration('docker', 1000);
    expect(getStepTimeoutMs('docker')).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('switches to average * 1.5 once the threshold is met', () => {
    recordSuccessfulStepDuration('terminal', 10000);
    recordSuccessfulStepDuration('terminal', 10000);
    recordSuccessfulStepDuration('terminal', 10000);
    // average 10000 * 1.5 buffer = 15000 (well above the floor, so the
    // real multiplier logic — not the floor — is what this asserts).
    expect(getStepTimeoutMs('terminal')).toBe(15000);
  });

  it('keeps only the most recent 10 samples, dropping older ones', () => {
    recordSuccessfulStepDuration('chrome', 1000); // will be dropped
    for (let i = 0; i < 10; i++) {
      recordSuccessfulStepDuration('chrome', 10000);
    }
    // If the dropped 1000ms sample were still counted (11 samples),
    // the average — and therefore the timeout — would be lower than
    // this.
    expect(getStepTimeoutMs('chrome')).toBe(15000);
  });

  it('tracks separate history per tool type', () => {
    recordSuccessfulStepDuration('slack', 4000);
    recordSuccessfulStepDuration('slack', 4000);
    recordSuccessfulStepDuration('slack', 4000);
    recordSuccessfulStepDuration('spotify', 9000);
    recordSuccessfulStepDuration('spotify', 9000);
    recordSuccessfulStepDuration('spotify', 9000);

    expect(getStepTimeoutMs('slack')).toBe(6000);
    expect(getStepTimeoutMs('spotify')).toBe(13500);
  });

  it('never returns below the minimum floor, even for a consistently very fast tool', () => {
    recordSuccessfulStepDuration('instant-tool', 10);
    recordSuccessfulStepDuration('instant-tool', 10);
    recordSuccessfulStepDuration('instant-tool', 10);
    // Raw average * 1.5 would be 15ms — far too tight to survive
    // ordinary scheduling jitter. The floor must win.
    expect(getStepTimeoutMs('instant-tool')).toBe(MIN_ADAPTIVE_TIMEOUT_MS);
  });

  describe('getTypicalStepDurationMs', () => {
    it('returns undefined for a tool type with no history', () => {
      expect(getTypicalStepDurationMs('display-never-seen')).toBeUndefined();
    });

    it('returns undefined below the minimum sample threshold (3)', () => {
      recordSuccessfulStepDuration('display-vscode', 3000);
      recordSuccessfulStepDuration('display-vscode', 3000);
      expect(getTypicalStepDurationMs('display-vscode')).toBeUndefined();
    });

    it('returns the rounded average once the threshold is met', () => {
      recordSuccessfulStepDuration('display-chrome', 1000);
      recordSuccessfulStepDuration('display-chrome', 2000);
      recordSuccessfulStepDuration('display-chrome', 3000);
      expect(getTypicalStepDurationMs('display-chrome')).toBe(2000);
    });

    it('keeps only the most recent 10 samples, dropping older ones', () => {
      recordSuccessfulStepDuration('display-spotify', 1000); // will be dropped
      for (let i = 0; i < 10; i++) {
        recordSuccessfulStepDuration('display-spotify', 5000);
      }
      // If the dropped 1000ms sample still counted (11 samples), the
      // average would be lower than this.
      expect(getTypicalStepDurationMs('display-spotify')).toBe(5000);
    });

    it('returns undefined, not NaN, if a stored sample is non-finite', () => {
      recordSuccessfulStepDuration('display-corrupted', 1000);
      recordSuccessfulStepDuration('display-corrupted', 2000);
      recordSuccessfulStepDuration('display-corrupted', NaN);
      expect(getTypicalStepDurationMs('display-corrupted')).toBeUndefined();
    });

    it('is a separate reading from getStepTimeoutMs — no 1.5x buffer applied', () => {
      recordSuccessfulStepDuration('display-vs-timeout', 10000);
      recordSuccessfulStepDuration('display-vs-timeout', 10000);
      recordSuccessfulStepDuration('display-vs-timeout', 10000);
      expect(getTypicalStepDurationMs('display-vs-timeout')).toBe(10000);
      expect(getStepTimeoutMs('display-vs-timeout')).toBe(15000);
    });

    it('blends two different generic "app"-type instances into one bucket — a known, accepted limitation, not a bug', () => {
      // The generic 'app' step type is keyed by the bare step type
      // string, same as every other type — there's no per-derived-name
      // bucketing. Re-keying it would silently break getStepTimeoutMs's
      // own lookups for the same store (see orchestrator.ts's doc
      // comment). This test documents the resulting behavior rather
      // than papering over it: a Figma-launch sample and an unrelated
      // Slack-launch sample both land in the one 'app' bucket and get
      // blended together.
      recordSuccessfulStepDuration('app', 2000); // e.g. Figma
      recordSuccessfulStepDuration('app', 2000);
      recordSuccessfulStepDuration('app', 8000); // e.g. Slack, much slower
      expect(getTypicalStepDurationMs('app')).toBe(4000);
    });
  });
});
