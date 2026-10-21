import { describe, expect, it, vi } from 'vitest';
import {
  clearHotkeyBinding,
  getAllHotkeyBindings,
  getHotkeyBinding,
  setHotkeyBinding,
} from './workspace-hotkeys-store';

// Same fake-store precedent as workspace-activity-store.test.ts/
// step-timing-history.test.ts — electron-store needs a real Electron
// `app` to resolve its storage path, unavailable under Vitest.
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

describe('workspace-hotkeys-store', () => {
  it('reports no binding for a never-touched workspace', () => {
    expect(getHotkeyBinding('never-touched')).toBeUndefined();
  });

  it('round-trips a binding through set/get', () => {
    setHotkeyBinding('ws-a', 'CommandOrControl+Alt+1');
    expect(getHotkeyBinding('ws-a')).toBe('CommandOrControl+Alt+1');
  });

  it('tracks bindings independently per workspace id', () => {
    setHotkeyBinding('ws-b', 'CommandOrControl+Alt+2');
    setHotkeyBinding('ws-c', 'CommandOrControl+Alt+3');

    expect(getAllHotkeyBindings()).toMatchObject({
      'ws-b': 'CommandOrControl+Alt+2',
      'ws-c': 'CommandOrControl+Alt+3',
    });
  });

  it('overwriting a binding replaces it, not adds a second one', () => {
    setHotkeyBinding('ws-d', 'CommandOrControl+Alt+4');
    setHotkeyBinding('ws-d', 'CommandOrControl+Alt+5');
    expect(getHotkeyBinding('ws-d')).toBe('CommandOrControl+Alt+5');
  });

  it('clearing a binding removes it without disturbing others', () => {
    setHotkeyBinding('ws-e', 'CommandOrControl+Alt+6');
    setHotkeyBinding('ws-f', 'CommandOrControl+Alt+7');

    clearHotkeyBinding('ws-e');

    expect(getHotkeyBinding('ws-e')).toBeUndefined();
    expect(getHotkeyBinding('ws-f')).toBe('CommandOrControl+Alt+7');
  });

  it('clearing a workspace with no binding is a harmless no-op', () => {
    expect(() => clearHotkeyBinding('never-bound')).not.toThrow();
  });
});
