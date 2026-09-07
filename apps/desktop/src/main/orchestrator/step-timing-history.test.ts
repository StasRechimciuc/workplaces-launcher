import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
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
    recordSuccessfulStepDuration('terminal', 1000);
    recordSuccessfulStepDuration('terminal', 1000);
    recordSuccessfulStepDuration('terminal', 1000);
    // average 1000 * 1.5 buffer = 1500
    expect(getStepTimeoutMs('terminal')).toBe(1500);
  });

  it('keeps only the most recent 10 samples, dropping older ones', () => {
    recordSuccessfulStepDuration('chrome', 100); // will be dropped
    for (let i = 0; i < 10; i++) {
      recordSuccessfulStepDuration('chrome', 200);
    }
    // If the dropped 100ms sample were still counted, the average
    // would be below 200 and the timeout below 300.
    expect(getStepTimeoutMs('chrome')).toBe(300);
  });

  it('tracks separate history per tool type', () => {
    recordSuccessfulStepDuration('slack', 10);
    recordSuccessfulStepDuration('slack', 10);
    recordSuccessfulStepDuration('slack', 10);
    recordSuccessfulStepDuration('spotify', 9000);
    recordSuccessfulStepDuration('spotify', 9000);
    recordSuccessfulStepDuration('spotify', 9000);

    expect(getStepTimeoutMs('slack')).toBe(15);
    expect(getStepTimeoutMs('spotify')).toBe(13500);
  });
});
