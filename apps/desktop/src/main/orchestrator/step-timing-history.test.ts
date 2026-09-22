import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
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
});
