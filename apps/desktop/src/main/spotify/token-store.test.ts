import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from 'electron';

// electron-store needs a real Electron app to resolve its storage path
// — unavailable under Vitest. Same FakeStore pattern as
// orchestrator/step-timing-history.test.ts.
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

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    // A real, reversible (not identity) stand-in for the OS keychain —
    // proves saveCredentials/loadRefreshToken actually round-trip
    // through encrypt/decrypt, not just pass a string through
    // untouched.
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${plain}`, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, '')),
  },
}));

// Imported after the mocks above (vi.mock calls are hoisted by Vitest,
// so this ordering in source doesn't matter, but matches convention).
import {
  clearCredentials,
  loadDisplayName,
  loadRefreshToken,
  saveCredentials,
} from './token-store';

describe('token-store', () => {
  beforeEach(() => {
    clearCredentials();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  });

  it('round-trips a refresh token through encrypt/decrypt, not plaintext', () => {
    saveCredentials('real-refresh-token', 'Stas');

    expect(safeStorage.encryptString).toHaveBeenCalledWith('real-refresh-token');
    expect(loadRefreshToken()).toBe('real-refresh-token');
  });

  it('persists the display name alongside the token, readable without decrypting', () => {
    saveCredentials('real-refresh-token', 'Stas');
    expect(loadDisplayName()).toBe('Stas');
  });

  it('returns null from loadRefreshToken when nothing has been saved', () => {
    expect(loadRefreshToken()).toBeNull();
  });

  it('clearCredentials resets both the token and display name to null', () => {
    saveCredentials('real-refresh-token', 'Stas');
    clearCredentials();

    expect(loadRefreshToken()).toBeNull();
    expect(loadDisplayName()).toBeNull();
  });

  it('fails loudly on saveCredentials when OS secure storage is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(() => saveCredentials('token', 'Stas')).toThrow(/secure storage is unavailable/);
  });

  it('fails loudly on loadRefreshToken when OS secure storage becomes unavailable after saving', () => {
    saveCredentials('real-refresh-token', 'Stas');
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

    expect(() => loadRefreshToken()).toThrow(/secure storage is unavailable/);
  });
});
