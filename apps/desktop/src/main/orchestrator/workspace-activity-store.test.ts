import { describe, expect, it, vi } from 'vitest';
import { isIntentActive, setIntentActive } from './workspace-activity-store';

// Same fake-store precedent as step-timing-history.test.ts — electron-store
// needs a real Electron `app` to resolve its storage path, unavailable
// under Vitest.
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

describe('workspace-activity-store', () => {
  it('reports a never-touched workspace as not intent-active', () => {
    expect(isIntentActive('never-touched')).toBe(false);
  });

  it('setIntentActive(id, true) then false round-trips correctly', () => {
    setIntentActive('ws-round-trip', true);
    expect(isIntentActive('ws-round-trip')).toBe(true);

    setIntentActive('ws-round-trip', false);
    expect(isIntentActive('ws-round-trip')).toBe(false);
  });

  it('tracks intent independently per workspace id', () => {
    setIntentActive('ws-independent-a', true);
    setIntentActive('ws-independent-b', false);

    expect(isIntentActive('ws-independent-a')).toBe(true);
    expect(isIntentActive('ws-independent-b')).toBe(false);
  });
});
