import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppCandidate, ToolAppKey } from '@workspace-launcher/shared';
import { scanInstalledApps } from './app-detection';

// electron-store needs a real Electron `app` to resolve its storage
// path — unavailable under Vitest. Faked with a plain in-memory object,
// same precedent as step-timing-history.test.ts.
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

vi.mock('./app-detection', () => ({
  scanInstalledApps: vi.fn(),
}));

const mockedScanInstalledApps = vi.mocked(scanInstalledApps);

function emptyCandidates(): Record<ToolAppKey, AppCandidate[]> {
  return { vscode: [], chrome: [], spotify: [], clockify: [] };
}

beforeEach(() => {
  mockedScanInstalledApps.mockReset();
  vi.useRealTimers();
});

describe('app-detection-cache', () => {
  it('getCandidatesForTool scans on first call (no cache yet) and caches the result', async () => {
    // Fresh module instance per test — the cache store is module-level
    // state, same reasoning orchestrator.test.ts's registry tests give
    // for vi.resetModules().
    vi.resetModules();
    const { getCandidatesForTool } = await import('./app-detection-cache');

    const candidates = { ...emptyCandidates(), vscode: [{ path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' }] };
    mockedScanInstalledApps.mockResolvedValueOnce(candidates);

    const result = await getCandidatesForTool('vscode');

    expect(result).toEqual(candidates.vscode);
    expect(mockedScanInstalledApps).toHaveBeenCalledTimes(1);
  });

  it('getCandidatesForTool returns cached data without rescanning when the cache is fresh', async () => {
    vi.resetModules();
    const { getCandidatesForTool } = await import('./app-detection-cache');

    const candidates = { ...emptyCandidates(), chrome: [{ path: '/Applications/Google Chrome.app', displayName: 'Google Chrome' }] };
    mockedScanInstalledApps.mockResolvedValueOnce(candidates);

    await getCandidatesForTool('chrome');
    const second = await getCandidatesForTool('chrome');

    expect(second).toEqual(candidates.chrome);
    expect(mockedScanInstalledApps).toHaveBeenCalledTimes(1);
  });

  it('getCandidatesForTool rescans once the cache is older than the TTL', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { getCandidatesForTool } = await import('./app-detection-cache');

    mockedScanInstalledApps.mockResolvedValueOnce(emptyCandidates());
    await getCandidatesForTool('spotify');

    vi.advanceTimersByTime(25 * 60 * 60 * 1000); // past the 24h TTL

    mockedScanInstalledApps.mockResolvedValueOnce(emptyCandidates());
    await getCandidatesForTool('spotify');

    expect(mockedScanInstalledApps).toHaveBeenCalledTimes(2);
  });

  it('rescanAndCache always scans, even when a fresh cache already exists', async () => {
    vi.resetModules();
    const { getCandidatesForTool, rescanAndCache } = await import('./app-detection-cache');

    mockedScanInstalledApps.mockResolvedValueOnce(emptyCandidates());
    await getCandidatesForTool('clockify');

    mockedScanInstalledApps.mockResolvedValueOnce(emptyCandidates());
    await rescanAndCache();

    expect(mockedScanInstalledApps).toHaveBeenCalledTimes(2);
  });

  it('rescanAndCache overwrites what getCandidatesForTool reads back afterward', async () => {
    vi.resetModules();
    const { getCandidatesForTool, rescanAndCache } = await import('./app-detection-cache');

    mockedScanInstalledApps.mockResolvedValueOnce(emptyCandidates());
    await getCandidatesForTool('vscode');

    const updated = { ...emptyCandidates(), vscode: [{ path: '/Applications/Visual Studio Code - Insiders.app', displayName: 'Visual Studio Code - Insiders' }] };
    mockedScanInstalledApps.mockResolvedValueOnce(updated);
    await rescanAndCache();

    const result = await getCandidatesForTool('vscode');
    expect(result).toEqual(updated.vscode);
    // Still fresh from rescanAndCache's own write — no 3rd scan needed.
    expect(mockedScanInstalledApps).toHaveBeenCalledTimes(2);
  });
});
