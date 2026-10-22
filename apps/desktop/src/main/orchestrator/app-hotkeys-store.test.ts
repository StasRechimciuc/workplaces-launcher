import { describe, expect, it, vi } from 'vitest';
import {
  clearSaveCurrentWorkspaceHotkey,
  getSaveCurrentWorkspaceHotkey,
  setSaveCurrentWorkspaceHotkey,
} from './app-hotkeys-store';

// Same fake-store precedent as workspace-hotkeys-store.test.ts.
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

describe('app-hotkeys-store', () => {
  it('reports no binding before anything is set', () => {
    expect(getSaveCurrentWorkspaceHotkey()).toBeUndefined();
  });

  it('round-trips a binding through set/get', () => {
    setSaveCurrentWorkspaceHotkey('CommandOrControl+Alt+S');
    expect(getSaveCurrentWorkspaceHotkey()).toBe('CommandOrControl+Alt+S');
  });

  it('overwriting replaces the binding, not adds a second one', () => {
    setSaveCurrentWorkspaceHotkey('CommandOrControl+Alt+S');
    setSaveCurrentWorkspaceHotkey('CommandOrControl+Alt+T');
    expect(getSaveCurrentWorkspaceHotkey()).toBe('CommandOrControl+Alt+T');
  });

  it('clearing removes the binding', () => {
    setSaveCurrentWorkspaceHotkey('CommandOrControl+Alt+S');
    clearSaveCurrentWorkspaceHotkey();
    expect(getSaveCurrentWorkspaceHotkey()).toBeUndefined();
  });

  it('clearing with nothing set is a harmless no-op', () => {
    expect(() => clearSaveCurrentWorkspaceHotkey()).not.toThrow();
  });
});
