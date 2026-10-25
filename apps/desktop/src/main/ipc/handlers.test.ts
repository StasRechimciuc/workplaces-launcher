import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES, RESTORE_PROGRESS_CHANNEL } from '@workspace-launcher/shared';
import { app, dialog, ipcMain } from 'electron';
import {
  clearAppHotkey,
  clearWorkspaceHotkey,
  closeWorkspaceStep,
  createWorkspace,
  deleteWorkspace,
  detectCurrentWorkspace,
  getAppHotkey,
  getLaunchOnLogin,
  listWorkspaces,
  markWorkspaceActive,
  registerIpcHandlers,
  restoreWorkspace,
  retryWorkspaceStep,
  setAppHotkey,
  setLaunchOnLogin,
  setWorkspaceHotkey,
  switchWorkspace,
  updateWorkspace,
} from './handlers';
import * as processControl from '../platform/macos/process-control';
import * as activityStore from '../orchestrator/workspace-activity-store';
import * as hotkeyService from '../orchestrator/hotkey-service';
import * as hotkeysStore from '../orchestrator/workspace-hotkeys-store';
import * as appHotkeysStore from '../orchestrator/app-hotkeys-store';
import { settingsStore } from '../settings/store';
import { registerBuiltInTools } from '../tools';
import { getPlatformLauncher } from '../platform';
import * as spotifyAuth from '../spotify/auth';
import { SpotifyReauthRequiredError } from '../spotify/auth';
import { listPlaylists as listSpotifyPlaylists } from '../spotify/playlists';
import { listChromeProfiles } from '../platform/chrome-profiles';
import { getAppIconDataUrl } from '../platform/app-icon';
import { rescanAndCache } from '../platform/app-detection-cache';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

// app-icon.ts shells out to plutil/sips and does real file I/O — its
// own extraction logic (Info.plist parsing, sips conversion, the
// fallback chain) is covered by app-icon.test.ts directly; mocked
// wholesale here, same precedent as chrome-profiles.ts below.
vi.mock('../platform/app-icon', () => ({
  getAppIconDataUrl: vi.fn(),
}));

// step-timing-history.ts (used by the orchestrator this transitively
// calls into) is backed by electron-store, which needs a real
// Electron `app` — unavailable under Vitest. See
// orchestrator.test.ts/step-timing-history.test.ts for the same mock
// and where that module's own logic is actually tested.
vi.mock('../orchestrator/step-timing-history', () => ({
  getStepTimeoutMs: () => 5000,
  recordSuccessfulStepDuration: () => {},
  getTypicalStepDurationMs: () => undefined,
}));

// Same electron-store hazard as step-timing-history.ts above — mocked
// wholesale here so listWorkspaces()'s `active` computation (which
// transitively calls into this via orchestrator.ts) never touches a
// real store. Its own get/set logic is covered directly by
// workspace-activity-store.test.ts.
vi.mock('../orchestrator/workspace-activity-store', () => ({
  isIntentActive: vi.fn(() => false),
  setIntentActive: vi.fn(),
}));

// hotkey-service.ts's own registration/rollback/debounce logic is
// covered directly by hotkey-service.test.ts; mocked wholesale here so
// these tests can assert handlers.ts correctly ORCHESTRATES calls into
// it (e.g. setWorkspaceHotkey rolling back on a reported failure)
// without a real globalShortcut registration.
vi.mock('../orchestrator/hotkey-service', () => ({
  syncHotkeys: vi.fn(() => ({ failed: [], appHotkeyFailed: false })),
  getFailedHotkeyBindings: vi.fn(() => []),
  getAppHotkeyFailed: vi.fn(() => false),
}));

// workspace-hotkeys-store.ts's own get/set/clear logic is covered
// directly by workspace-hotkeys-store.test.ts — same electron-store
// hazard as workspace-activity-store.ts above.
vi.mock('../orchestrator/workspace-hotkeys-store', () => ({
  getHotkeyBinding: vi.fn(() => undefined),
  getAllHotkeyBindings: vi.fn(() => ({})),
  setHotkeyBinding: vi.fn(),
  clearHotkeyBinding: vi.fn(),
}));

// app-hotkeys-store.ts's own get/set/clear logic is covered directly
// by app-hotkeys-store.test.ts — same electron-store hazard as
// workspace-hotkeys-store.ts above.
vi.mock('../orchestrator/app-hotkeys-store', () => ({
  getSaveCurrentWorkspaceHotkey: vi.fn(() => undefined),
  setSaveCurrentWorkspaceHotkey: vi.fn(),
  clearSaveCurrentWorkspaceHotkey: vi.fn(),
}));

// workspace-detection.ts's own detection/matching logic is covered
// directly by workspace-detection.test.ts; mocked wholesale here so
// these tests can assert handlers.ts's thin detectCurrentWorkspace
// wrapper without a real macOS detection pass (lsappinfo/osascript/ps/
// lsof calls, none of which belong in an IPC-handler-shape test).
vi.mock('../orchestrator/workspace-detection', () => ({
  detectCurrentWorkspaceDraft: vi.fn(async () => ({
    status: 'ready',
    steps: [],
    unmatched: [],
    issues: [],
  })),
}));

// settings/store.ts constructs an electron-store Store at module load
// — same hazard as every other electron-store-backed module above.
vi.mock('../settings/store', () => ({
  settingsStore: { get: vi.fn(), set: vi.fn() },
}));

// process-control.ts shells out to real osascript — every
// listWorkspaces() call now transitively computes `active` via this,
// so it must never run for real in a test (slow, non-deterministic,
// and would fail outright off-macOS). Its own parsing/success-shape
// logic is covered directly by process-control.test.ts.
vi.mock('../platform/macos/process-control', () => ({
  isAppRunning: vi.fn().mockResolvedValue(false),
  quitApp: vi.fn().mockResolvedValue({ success: true, message: '' }),
  waitForAppRunning: vi.fn().mockResolvedValue({ detected: false, elapsedMs: 0 }),
}));

// spotify/auth.ts (transitively) constructs an electron-store Store at
// module import time, same hazard step-timing-history.ts's own comment
// above describes — mocked wholesale here for the same reason, rather
// than mocking electron-store/safeStorage individually. Its own
// encrypt/decrypt/token logic is covered by token-store.test.ts and
// auth.test.ts instead.
vi.mock('../spotify/auth', () => {
  class SpotifyReauthRequiredError extends Error {}
  return {
    connect: vi.fn(),
    getConnectionStatus: vi.fn(),
    disconnect: vi.fn(),
    SpotifyReauthRequiredError,
  };
});

vi.mock('../spotify/playlists', () => ({
  listPlaylists: vi.fn(),
}));

// '../platform' (the barrel, mocked above for getPlatformLauncher) and
// '../platform/chrome-profiles' are distinct module specifiers to
// Vitest's mock resolver — mocking the barrel does not also mock this
// sibling file, so it needs its own entry.
vi.mock('../platform/chrome-profiles', () => ({
  listChromeProfiles: vi.fn(),
}));

// Same electron-store hazard as step-timing-history.ts/
// workspace-activity-store.ts below — real app-location detection also
// shells out to plutil/scans /Applications, never exercised here. Its
// own logic is covered directly by
// app-detection.test.ts/app-detection-cache.test.ts. Both exports
// stubbed: resolve-app-path.ts (reached transitively by every real
// restore/retry in this file) imports getCandidatesForTool, not just
// the app:detectInstalls handler's own rescanAndCache.
vi.mock('../platform/app-detection-cache', () => ({
  rescanAndCache: vi.fn(),
  getCandidatesForTool: vi.fn(() => Promise.resolve([])),
}));

// config/loader.ts (used by restoreWorkspace to check for a real saved
// config, and by createWorkspace/listWorkspaces to save/load them)
// only calls app.getPath('userData') — faked with a real temp
// directory per test, same convention as config/loader.test.ts.
let testUserDataDir: string;

// A minimal fake BrowserWindow — just enough surface for
// restore-focus.ts's calls (isDestroyed/isMinimized/setAlwaysOnTop/
// moveTop/focus). Reset per test in beforeEach below.
const mockWin = {
  isDestroyed: vi.fn(() => false),
  isMinimized: vi.fn(() => false),
  setAlwaysOnTop: vi.fn(),
  moveTop: vi.fn(),
  focus: vi.fn(),
  webContents: {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  },
};

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataDir,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
    // Defaults to a packaged build so most tests exercise the normal
    // path; the dev-build guard tests override this to false.
    isPackaged: true,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWin),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

// `app.isPackaged` is typed readonly in Electron's real .d.ts (which
// this mock's static type still carries) — this helper is the one
// place that casts past it, rather than scattering `as unknown as`
// at every call site.
function setAppPackaged(value: boolean): void {
  (app as unknown as { isPackaged: boolean }).isPackaged = value;
}

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openInApp = vi.fn();
const openUrlInBrowserProfile = vi.fn();
const openTerminal = vi.fn();

beforeAll(() => {
  // Real startup wiring (main/index.ts calls this once) — needed so
  // 'vscode'/'chrome'/'spotify' steps resolve to their real tools
  // instead of "no registered tool," same as it will at runtime.
  registerBuiltInTools();
});

beforeEach(async () => {
  testUserDataDir = await mkdtemp(join(tmpdir(), 'workspace-launcher-test-'));
  openInApp.mockReset().mockResolvedValue({ success: true, message: 'Opened.' });
  openUrlInBrowserProfile.mockReset().mockResolvedValue({ success: true, message: 'Opened.' });
  openTerminal.mockReset().mockResolvedValue({ success: true, message: 'Opened a terminal.' });
  mockedGetPlatformLauncher.mockReset().mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile,
    openTerminal,
    openFileDefault: vi.fn(),
    openUrlDefault: vi.fn(),
  });
  mockWin.isDestroyed.mockReset().mockReturnValue(false);
  mockWin.isMinimized.mockReset().mockReturnValue(false);
  mockWin.setAlwaysOnTop.mockReset();
  mockWin.moveTop.mockReset();
  mockWin.focus.mockReset();
  mockWin.webContents.send.mockReset();
  mockWin.webContents.isDestroyed.mockReset().mockReturnValue(false);
  vi.mocked(ipcMain.handle).mockReset();
  vi.mocked(dialog.showOpenDialog).mockReset();
  vi.mocked(getAppIconDataUrl).mockReset();
  vi.mocked(spotifyAuth.connect).mockReset();
  vi.mocked(spotifyAuth.getConnectionStatus).mockReset();
  vi.mocked(spotifyAuth.disconnect).mockReset();
  vi.mocked(listSpotifyPlaylists).mockReset();
  vi.mocked(listChromeProfiles).mockReset();
  vi.mocked(rescanAndCache).mockReset();
  vi.mocked(app.getLoginItemSettings)
    .mockReset()
    .mockReturnValue({ openAtLogin: false } as never);
  vi.mocked(app.setLoginItemSettings).mockReset();
  setAppPackaged(true);
  vi.mocked(hotkeyService.syncHotkeys)
    .mockReset()
    .mockReturnValue({ failed: [], appHotkeyFailed: false });
  vi.mocked(hotkeyService.getFailedHotkeyBindings).mockReset().mockReturnValue([]);
  vi.mocked(hotkeyService.getAppHotkeyFailed).mockReset().mockReturnValue(false);
  vi.mocked(hotkeysStore.getHotkeyBinding).mockReset().mockReturnValue(undefined);
  vi.mocked(hotkeysStore.getAllHotkeyBindings).mockReset().mockReturnValue({});
  vi.mocked(hotkeysStore.setHotkeyBinding).mockReset();
  vi.mocked(hotkeysStore.clearHotkeyBinding).mockReset();
  vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReset().mockReturnValue(undefined);
  vi.mocked(appHotkeysStore.setSaveCurrentWorkspaceHotkey).mockReset();
  vi.mocked(appHotkeysStore.clearSaveCurrentWorkspaceHotkey).mockReset();
  vi.mocked(settingsStore.get).mockReset();
  vi.mocked(settingsStore.set).mockReset();
});

afterEach(async () => {
  await rm(testUserDataDir, { recursive: true, force: true });
});

/**
 * A real, saved workspace mixing registered tool types (vscode, chrome,
 * spotify, terminal — run for real) with an unregistered one (slack —
 * no plugin built yet, so it reports a graceful per-step failure).
 * Docker is now a registered, real tool too (docker-tool.ts) — its own
 * execution is covered directly by docker-tool.test.ts, not retrofitted
 * into this shared fixture, since its compose path genuinely shells out
 * and its tilt path goes through the mocked PlatformLauncher differently
 * than the other steps here. Mirrors the shape the old bundled demo
 * workspace used to cover in these tests, now built fresh per test via
 * the real createWorkspace path instead of hardcoded fixture data.
 */
async function createMixedWorkspace(): Promise<string> {
  const result = await createWorkspace({
    name: 'Mixed test workspace',
    steps: [
      { type: 'vscode', params: { path: '~/real' } },
      { type: 'slack', params: {} },
      { type: 'terminal', params: { terminals: [{ cwd: '~/real', commands: ['npm run dev'] }] } },
      { type: 'chrome', params: { profile: 'Default', urls: ['https://example.com'] } },
      { type: 'spotify', params: { playlist: 'spotify:playlist:abc' } },
    ],
  });
  if (!result.success) throw new Error('setup failed: ' + result.error);
  return result.config.id;
}

describe('restoreWorkspace', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(restoreWorkspace(123)).rejects.toThrow(/workspace id/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(restoreWorkspace('does-not-exist')).rejects.toThrow(/No workspace found/);
  });

  it("runs a workspace's mixed registered/unregistered steps through the orchestrator", async () => {
    const id = await createMixedWorkspace();
    const results = await restoreWorkspace(id);

    expect(results).toHaveLength(5);
    // vscode's path + spotify's playlist both go through openInApp.
    expect(openInApp).toHaveBeenCalledTimes(2);
    // chrome's one configured url.
    expect(openUrlInBrowserProfile).toHaveBeenCalledTimes(1);
  });

  it('runs the registered vscode step as a real success, not a stub', async () => {
    const id = await createMixedWorkspace();
    const results = await restoreWorkspace(id);
    expect(results[0]).toMatchObject({ success: true });
  });

  it('reports a not-yet-built tool type as a failed step, not a crash', async () => {
    const id = await createMixedWorkspace();
    const results = await restoreWorkspace(id);
    const slackResult = results[1];
    expect(slackResult?.success).toBe(false);
    expect(slackResult?.message).toContain('slack');
  });

  it('runs the registered terminal step through the real platform launcher, not just a mocked unit test', async () => {
    const id = await createMixedWorkspace();
    const results = await restoreWorkspace(id);

    expect(openTerminal).toHaveBeenCalledWith('~/real', ['npm run dev']);
    expect(results[2]).toMatchObject({ success: true });
  });

  it('restores a real saved workspace loaded from disk', async () => {
    const created = await createWorkspace({
      name: 'Real one',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed: ' + created.error);

    const results = await restoreWorkspace(created.config.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: true });
  });

  it('calls the optional onProgress callback with a running+final event per step', async () => {
    const id = await createMixedWorkspace();
    const onProgress = vi.fn();
    await restoreWorkspace(id, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(10);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: id, stepIndex: 0, status: 'running' }),
    );
  });
});

describe('retryWorkspaceStep', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(retryWorkspaceStep(123, 0)).rejects.toThrow(/workspace id/);
  });

  it('throws for a non-integer step index', async () => {
    await expect(retryWorkspaceStep('client-a', 1.5)).rejects.toThrow(/step index/);
  });

  it('throws for a negative step index', async () => {
    await expect(retryWorkspaceStep('client-a', -1)).rejects.toThrow(/step index/);
  });

  it('throws for a non-number step index', async () => {
    await expect(retryWorkspaceStep('client-a', '0')).rejects.toThrow(/step index/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(retryWorkspaceStep('does-not-exist', 0)).rejects.toThrow(/No workspace found/);
  });

  it("retries a workspace's registered step as a real run, not a stub", async () => {
    const id = await createMixedWorkspace();
    // step 0 is vscode, a registered tool.
    const result = await retryWorkspaceStep(id, 0);
    expect(result).toMatchObject({ success: true });
    expect(openInApp).toHaveBeenCalledTimes(1);
  });

  it('reports a not-yet-built tool type as a failed step, not a crash', async () => {
    const id = await createMixedWorkspace();
    // step 1 is slack — no plugin registered for it.
    const result = await retryWorkspaceStep(id, 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain('slack');
  });

  it('retries a step on a real saved workspace loaded from disk', async () => {
    const created = await createWorkspace({
      name: 'Real one',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed: ' + created.error);

    const result = await retryWorkspaceStep(created.config.id, 0);
    expect(result).toMatchObject({ success: true });
  });

  it('reports a failed result, not a throw, for an out-of-range step index', async () => {
    const id = await createMixedWorkspace();
    const result = await retryWorkspaceStep(id, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No step at index 999');
  });
});

describe('switchWorkspace', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(switchWorkspace(123)).rejects.toThrow(/workspace id/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(switchWorkspace('does-not-exist')).rejects.toThrow(/No workspace found/);
  });

  it('restores the target workspace (closing/opening bookkeeping covered by orchestrator.test.ts)', async () => {
    const id = await createMixedWorkspace();
    const result = await switchWorkspace(id);
    expect(result.stepResults.length).toBeGreaterThan(0);
  });
});

describe('closeWorkspaceStep', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(closeWorkspaceStep(123)).rejects.toThrow(/workspace id/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(closeWorkspaceStep('does-not-exist')).rejects.toThrow(/No workspace found/);
  });

  it('resolves without throwing for a known workspace', async () => {
    const id = await createMixedWorkspace();
    const result = await closeWorkspaceStep(id);
    expect(result).toHaveProperty('closed');
    expect(result).toHaveProperty('leftOpen');
  });
});

describe('registerIpcHandlers — workspaces:retryStep', () => {
  it('registers the channel and delegates to retryWorkspaceStep', async () => {
    const id = await createMixedWorkspace();
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'workspaces:retryStep');
    if (!call) throw new Error('workspaces:retryStep was never registered');
    const handler = call[1] as (
      event: unknown,
      workspaceId: unknown,
      stepIndex: unknown,
    ) => Promise<unknown>;

    const result = await handler({}, id, 0);
    expect(result).toMatchObject({ success: true });
  });
});

describe('registerIpcHandlers — workspaces:restore progress + focus wiring', () => {
  let mixedWorkspaceId: string;
  beforeEach(async () => {
    mixedWorkspaceId = await createMixedWorkspace();
  });

  function getRegisteredRestoreHandler(): (
    event: { sender: unknown },
    workspaceId: unknown,
  ) => Promise<unknown> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'workspaces:restore');
    if (!call) throw new Error('workspaces:restore was never registered');
    return call[1] as never;
  }

  // BrowserWindow.fromWebContents is mocked to always return the
  // shared mockWin regardless of what event.sender is — restoreWorkspaceWithFocus
  // (handlers.ts) sends/checks-destroyed through win.webContents, not
  // event.sender directly, so these tests drive mockWin.webContents
  // rather than constructing a custom event.sender.
  const fakeEvent = { sender: {} };

  it('pushes a progress event per step over the IPC channel and re-asserts window focus', async () => {
    const handler = getRegisteredRestoreHandler();

    const results = await handler(fakeEvent, mixedWorkspaceId);

    expect(results).toHaveLength(5);
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(10);
    expect(mockWin.webContents.send.mock.calls[0]).toEqual([
      RESTORE_PROGRESS_CHANNEL,
      expect.objectContaining({ workspaceId: mixedWorkspaceId, stepIndex: 0, status: 'running' }),
    ]);
    // Focus lifecycle: pinned at the start, re-asserted on the first
    // 'running' event, cleared once the whole restore has resolved.
    expect(mockWin.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(mockWin.moveTop).toHaveBeenCalled();
    expect(mockWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('never lets a destroyed webContents throw into the orchestrator, and still returns every result', async () => {
    mockWin.webContents.send.mockImplementation(() => {
      throw new Error('Object has been destroyed');
    });
    const handler = getRegisteredRestoreHandler();

    const results = await handler(fakeEvent, mixedWorkspaceId);

    // The exact failure mode the adversarial review caught: a throwing
    // send() must never abort the run or discard already-collected
    // results.
    expect(results).toHaveLength(5);
  });

  it('skips sending when the webContents is already destroyed, without throwing', async () => {
    mockWin.webContents.isDestroyed.mockReturnValue(true);
    const handler = getRegisteredRestoreHandler();

    const results = await handler(fakeEvent, mixedWorkspaceId);

    expect(results).toHaveLength(5);
    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('never lets a throwing focus reassert abort the restore either', async () => {
    // The first moveTop() call is startRestoreFocusSession's own
    // begin() — let that succeed, and only fail the calls reassert()
    // makes per step, isolating the specific try/catch this test is
    // for from the (separately unguarded) begin() call.
    mockWin.moveTop
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error('native window error');
      });
    const handler = getRegisteredRestoreHandler();

    const results = await handler(fakeEvent, mixedWorkspaceId);

    // Same failure class as the destroyed-webContents case above, but
    // for restore-focus.ts's moveTop()/focus() calls instead of send().
    expect(results).toHaveLength(5);
  });
});

describe('registerIpcHandlers — dialog:selectProjectFolder', () => {
  function getRegisteredDialogHandler(): (event: { sender: unknown }) => Promise<string | null> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'dialog:selectProjectFolder');
    if (!call) throw new Error('dialog:selectProjectFolder was never registered');
    return call[1] as never;
  }

  it('returns the picked path on success', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/stas/projects/client-a'],
    });
    const handler = getRegisteredDialogHandler();

    const result = await handler({ sender: {} });

    expect(result).toBe('/Users/stas/projects/client-a');
  });

  it('returns null when the user cancels the dialog', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const handler = getRegisteredDialogHandler();

    expect(await handler({ sender: {} })).toBeNull();
  });

  it('returns null when filePaths is empty even if not marked canceled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [] });
    const handler = getRegisteredDialogHandler();

    expect(await handler({ sender: {} })).toBeNull();
  });

  it('falls back to the no-window overload when BrowserWindow.fromWebContents returns null', async () => {
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/some/path'],
    });
    const handler = getRegisteredDialogHandler();

    const result = await handler({ sender: {} });

    expect(result).toBe('/some/path');
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] });
  });
});

describe('registerIpcHandlers — dialog:selectApp', () => {
  function getRegisteredSelectAppHandler(): (event: { sender: unknown }) => Promise<string | null> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'dialog:selectApp');
    if (!call) throw new Error('dialog:selectApp was never registered');
    return call[1] as never;
  }

  it('returns the picked .app bundle path on success', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Applications/Figma.app'],
    });
    const handler = getRegisteredSelectAppHandler();

    expect(await handler({ sender: {} })).toBe('/Applications/Figma.app');
  });

  it('returns null when the user cancels the dialog', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const handler = getRegisteredSelectAppHandler();

    expect(await handler({ sender: {} })).toBeNull();
  });

  it('filters to .app bundles and defaults to /Applications', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Applications/Figma.app'],
    });
    const handler = getRegisteredSelectAppHandler();

    await handler({ sender: {} });

    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'Applications', extensions: ['app'] }],
        defaultPath: '/Applications',
      }),
    );
  });

  it('falls back to the no-window overload when BrowserWindow.fromWebContents returns null', async () => {
    const { BrowserWindow } = await import('electron');
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Applications/Figma.app'],
    });
    const handler = getRegisteredSelectAppHandler();

    const result = await handler({ sender: {} });

    expect(result).toBe('/Applications/Figma.app');
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile'] }),
    );
  });
});

describe('registerIpcHandlers — spotify:*', () => {
  function getRegisteredSpotifyHandler(
    channel: 'spotify:connect' | 'spotify:status' | 'spotify:disconnect' | 'spotify:listPlaylists',
  ): (event: { sender: unknown }) => Promise<unknown> {
    registerIpcHandlers();
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
    if (!call) throw new Error(`${channel} was never registered`);
    return call[1] as never;
  }

  it('spotify:connect delegates to auth.connect() and returns its result unchanged', async () => {
    vi.mocked(spotifyAuth.connect).mockResolvedValueOnce({ success: true, displayName: 'Stas' });
    const handler = getRegisteredSpotifyHandler('spotify:connect');

    expect(await handler({ sender: {} })).toEqual({ success: true, displayName: 'Stas' });
  });

  it('spotify:status delegates to auth.getConnectionStatus() and returns its result unchanged', async () => {
    vi.mocked(spotifyAuth.getConnectionStatus).mockResolvedValueOnce({
      connected: true,
      displayName: 'Stas',
    });
    const handler = getRegisteredSpotifyHandler('spotify:status');

    expect(await handler({ sender: {} })).toEqual({ connected: true, displayName: 'Stas' });
  });

  it('spotify:disconnect calls auth.disconnect()', async () => {
    const handler = getRegisteredSpotifyHandler('spotify:disconnect');

    await handler({ sender: {} });

    expect(spotifyAuth.disconnect).toHaveBeenCalledTimes(1);
  });

  it('spotify:listPlaylists returns {success:true, playlists} on success', async () => {
    const playlists = [
      { id: '1', name: 'Deep Focus', uri: 'spotify:playlist:1', ownedByCurrentUser: true },
    ];
    vi.mocked(listSpotifyPlaylists).mockResolvedValueOnce(playlists);
    const handler = getRegisteredSpotifyHandler('spotify:listPlaylists');

    expect(await handler({ sender: {} })).toEqual({ success: true, playlists });
  });

  it('spotify:listPlaylists maps SpotifyReauthRequiredError to a specific reauth-required error', async () => {
    vi.mocked(listSpotifyPlaylists).mockRejectedValueOnce(new SpotifyReauthRequiredError());
    const handler = getRegisteredSpotifyHandler('spotify:listPlaylists');

    expect(await handler({ sender: {} })).toEqual({
      success: false,
      error: 'reauth-required',
      code: ERROR_CODES.SPOTIFY_REAUTH_REQUIRED.code,
    });
  });

  it('spotify:listPlaylists maps any other failure to its message, not a thrown exception', async () => {
    vi.mocked(listSpotifyPlaylists).mockRejectedValueOnce(new Error('network down'));
    const handler = getRegisteredSpotifyHandler('spotify:listPlaylists');

    expect(await handler({ sender: {} })).toEqual({
      success: false,
      error: 'network down',
      code: ERROR_CODES.SPOTIFY_PLAYLISTS_FAILED.code,
    });
  });
});

describe('registerIpcHandlers — chrome:listProfiles', () => {
  function getRegisteredChromeHandler(): (event: { sender: unknown }) => Promise<unknown> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'chrome:listProfiles');
    if (!call) throw new Error('chrome:listProfiles was never registered');
    return call[1] as never;
  }

  it('returns {success:true, profiles} on success', async () => {
    const profiles = [{ folder: 'Default', name: 'Work' }];
    vi.mocked(listChromeProfiles).mockResolvedValueOnce(profiles);
    const handler = getRegisteredChromeHandler();

    expect(await handler({ sender: {} })).toEqual({ success: true, profiles });
  });

  it('maps a failure to {success:false, error}, not a thrown exception', async () => {
    vi.mocked(listChromeProfiles).mockRejectedValueOnce(
      new Error("Chrome doesn't appear to be installed"),
    );
    const handler = getRegisteredChromeHandler();

    expect(await handler({ sender: {} })).toEqual({
      success: false,
      error: "Chrome doesn't appear to be installed",
      code: ERROR_CODES.CHROME_PROFILES_UNAVAILABLE.code,
    });
  });
});

describe('registerIpcHandlers — app:detectInstalls', () => {
  function getRegisteredDetectHandler(): (event: unknown, toolKey: unknown) => Promise<unknown> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'app:detectInstalls');
    if (!call) throw new Error('app:detectInstalls was never registered');
    return call[1] as never;
  }

  it('returns {success:true, candidates} for a known tool key', async () => {
    const candidates = [
      { path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' },
    ];
    vi.mocked(rescanAndCache).mockResolvedValueOnce({
      vscode: candidates,
      chrome: [],
      spotify: [],
      clockify: [],
    });
    const handler = getRegisteredDetectHandler();

    expect(await handler({}, 'vscode')).toEqual({ success: true, candidates });
  });

  it('throws synchronously for an unknown/missing tool key, without ever scanning', async () => {
    const handler = getRegisteredDetectHandler();

    await expect(handler({}, 'not-a-real-tool')).rejects.toThrow(/known tool key/);
    await expect(handler({}, undefined)).rejects.toThrow(/known tool key/);
    expect(rescanAndCache).not.toHaveBeenCalled();
  });

  it('maps a scan failure to {success:false, error}, not a thrown exception', async () => {
    vi.mocked(rescanAndCache).mockRejectedValueOnce(new Error('permission denied'));
    const handler = getRegisteredDetectHandler();

    expect(await handler({}, 'chrome')).toEqual({
      success: false,
      error: 'permission denied',
      code: ERROR_CODES.APP_DETECTION_FAILED.code,
    });
  });

  // The non-macOS guard (SUPPORTS_APP_DETECTION) is a module-level
  // constant computed at import time from process.platform — same
  // "not worth the fragility" reasoning listWorkspaces' own 'active'
  // describe block gives for SUPPORTS_WORKSPACE_ACTIVITY; verified by
  // inspection instead (handlers.ts's SUPPORTS_APP_DETECTION and its
  // one guarded call site above).
});

describe('createWorkspace', () => {
  it('rejects a non-object input', async () => {
    await expect(createWorkspace('nope')).rejects.toThrow(/name, steps/);
  });

  it('rejects an empty workspace name', async () => {
    const result = await createWorkspace({ name: '', steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a vscode step with an empty path via the tool's real validate()", async () => {
    const result = await createWorkspace({
      name: 'My workspace',
      steps: [{ type: 'vscode', params: { path: '' } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('path');
      expect(result.code).toBe(ERROR_CODES.WORKSPACE_INVALID.code);
    }
  });

  it('names the real failing stepIndex and its fieldErrors, not just a flat message', async () => {
    const result = await createWorkspace({
      name: 'My workspace',
      steps: [
        { type: 'vscode', params: { path: '~/real' } },
        { type: 'vscode', params: { path: '' } },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.stepIndex).toBe(1);
      expect(result.fieldErrors).toEqual({ path: expect.stringContaining('path') });
    }
  });

  it('allows a step type with no registered tool yet (e.g. slack), unvalidated', async () => {
    const result = await createWorkspace({
      name: 'My workspace',
      steps: [{ type: 'slack', params: {} }],
    });
    expect(result.success).toBe(true);
  });

  it('saves a valid workspace to a real file and returns its generated config', async () => {
    const result = await createWorkspace({
      name: 'My workspace',
      steps: [{ type: 'vscode', params: { path: '~/projects/x' } }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.name).toBe('My workspace');
      expect(result.config.id.length).toBeGreaterThan(0);

      const written = await readFile(
        join(testUserDataDir, 'workspaces', `${result.config.id}.json`),
        'utf-8',
      );
      expect(JSON.parse(written)).toEqual(result.config);
    }
  });
});

describe('updateWorkspace', () => {
  it('rejects a non-object input', async () => {
    await expect(updateWorkspace('nope')).rejects.toThrow(/id, name, steps/);
  });

  it('rejects a non-string/empty id', async () => {
    await expect(updateWorkspace({ id: 123, name: 'X', steps: [] })).rejects.toThrow(/"id"/);
  });

  it('rejects an unknown workspace id', async () => {
    const result = await updateWorkspace({ id: 'does-not-exist', name: 'X', steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/No workspace found/);
      expect(result.code).toBe(ERROR_CODES.WORKSPACE_NOT_FOUND.code);
    }
  });

  it('rejects an empty new name via the same schema as createWorkspace', async () => {
    const created = await createWorkspace({ name: 'Original', steps: [] });
    if (!created.success) throw new Error('setup failed');

    const result = await updateWorkspace({ id: created.config.id, name: '', steps: [] });
    expect(result.success).toBe(false);
  });

  it("reuses createWorkspace's per-step tool validation", async () => {
    const created = await createWorkspace({
      name: 'Original',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed');

    const result = await updateWorkspace({
      id: created.config.id,
      name: 'Original',
      steps: [{ type: 'vscode', params: { path: '' } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('path');
      expect(result.code).toBe(ERROR_CODES.WORKSPACE_INVALID.code);
      expect(result.stepIndex).toBe(0);
      expect(result.fieldErrors).toEqual({ path: expect.stringContaining('path') });
    }
  });

  it('overwrites the saved file in place, id unchanged, loadable afterward', async () => {
    const created = await createWorkspace({
      name: 'Original',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed');

    const result = await updateWorkspace({
      id: created.config.id,
      name: 'Renamed',
      steps: [{ type: 'vscode', params: { path: '~/renamed' } }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.id).toBe(created.config.id);
      expect(result.config.name).toBe('Renamed');

      const written = JSON.parse(
        await readFile(join(testUserDataDir, 'workspaces', `${created.config.id}.json`), 'utf-8'),
      );
      expect(written.name).toBe('Renamed');
    }
  });
});

describe('deleteWorkspace', () => {
  it('throws for a non-string/empty workspace id', async () => {
    await expect(deleteWorkspace(123)).rejects.toThrow(/workspace id/);
  });

  it('rejects an unknown workspace id', async () => {
    const result = await deleteWorkspace('does-not-exist');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/No workspace found/);
      expect(result.code).toBe(ERROR_CODES.WORKSPACE_NOT_FOUND.code);
    }
  });

  it('deletes a real saved workspace, removing its file and from listWorkspaces', async () => {
    const created = await createWorkspace({ name: 'To delete', steps: [] });
    if (!created.success) throw new Error('setup failed');

    const result = await deleteWorkspace(created.config.id);
    expect(result).toEqual({ success: true });

    await expect(
      readFile(join(testUserDataDir, 'workspaces', `${created.config.id}.json`), 'utf-8'),
    ).rejects.toThrow();

    const all = await listWorkspaces();
    expect(all.some((ws) => ws.id === created.config.id)).toBe(false);
  });

  it('reports "No workspace found" (not a silent no-op) on a second delete of the same id', async () => {
    const created = await createWorkspace({ name: 'To delete', steps: [] });
    if (!created.success) throw new Error('setup failed');
    await deleteWorkspace(created.config.id);

    const second = await deleteWorkspace(created.config.id);
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error).toMatch(/No workspace found/);
      expect(second.code).toBe(ERROR_CODES.WORKSPACE_NOT_FOUND.code);
    }
  });

  it('clears any global hotkey bound to the deleted workspace and re-syncs', async () => {
    const created = await createWorkspace({ name: 'To delete', steps: [] });
    if (!created.success) throw new Error('setup failed');

    await deleteWorkspace(created.config.id);

    expect(hotkeysStore.clearHotkeyBinding).toHaveBeenCalledWith(created.config.id);
    expect(hotkeyService.syncHotkeys).toHaveBeenCalled();
  });

  it('does not clear a hotkey binding or re-sync on a failed delete (unknown id)', async () => {
    await deleteWorkspace('does-not-exist');

    expect(hotkeysStore.clearHotkeyBinding).not.toHaveBeenCalled();
    expect(hotkeyService.syncHotkeys).not.toHaveBeenCalled();
  });
});

describe('setWorkspaceHotkey', () => {
  it('throws for a non-string/empty workspace id', async () => {
    await expect(setWorkspaceHotkey(123, 'CommandOrControl+Alt+1')).rejects.toThrow(/workspace id/);
  });

  it('rejects a malformed accelerator without ever touching the store', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');

    const result = await setWorkspaceHotkey(created.config.id, 'not a real accelerator');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_INVALID.code });
    expect(hotkeysStore.setHotkeyBinding).not.toHaveBeenCalled();
  });

  it('rejects a Shift-containing combo (reserved for the derived Switch variant)', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Shift+1');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_INVALID.code });
  });

  it('rejects an unknown workspace id', async () => {
    const result = await setWorkspaceHotkey('does-not-exist', 'CommandOrControl+Alt+1');
    expect(result).toMatchObject({ success: false, code: ERROR_CODES.WORKSPACE_NOT_FOUND.code });
  });

  it('persists and syncs a well-formed combo for a real workspace', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    expect(result).toEqual({ success: true });
    expect(hotkeysStore.setHotkeyBinding).toHaveBeenCalledWith(
      created.config.id,
      'CommandOrControl+Alt+1',
    );
    expect(hotkeyService.syncHotkeys).toHaveBeenCalled();
  });

  it('rejects a combo already bound to ANOTHER workspace, naming it, without touching the store', async () => {
    const existing = await createWorkspace({ name: 'Existing workspace', steps: [] });
    const created = await createWorkspace({ name: 'New workspace', steps: [] });
    if (!existing.success || !created.success) throw new Error('setup failed');
    vi.mocked(hotkeysStore.getAllHotkeyBindings).mockReturnValue({
      [existing.config.id]: 'CommandOrControl+Alt+1',
    });

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    // This must be caught by name BEFORE touching the store at all —
    // syncHotkeys()'s own insertion-order-dependent failure detection
    // could otherwise just as easily report the OTHER (pre-existing)
    // workspace as the one that broke, silently killing a hotkey that
    // was working fine a moment ago while this request reports success.
    expect(result).toEqual({
      success: false,
      error: 'Already bound to "Existing workspace".',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    });
    expect(hotkeysStore.setHotkeyBinding).not.toHaveBeenCalled();
    expect(hotkeyService.syncHotkeys).not.toHaveBeenCalled();
  });

  it('allows re-recording the SAME combo for the SAME workspace without a false collision', async () => {
    const created = await createWorkspace({ name: 'Self workspace', steps: [] });
    if (!created.success) throw new Error('setup failed');
    vi.mocked(hotkeysStore.getAllHotkeyBindings).mockReturnValue({
      [created.config.id]: 'CommandOrControl+Alt+1',
    });

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    expect(result).toEqual({ success: true });
  });

  it('rolls back to the PREVIOUS binding (not just clears it) when the new one fails to register', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');
    vi.mocked(hotkeysStore.getHotkeyBinding).mockReturnValue('CommandOrControl+Alt+9');
    vi.mocked(hotkeyService.syncHotkeys).mockReturnValueOnce({
      failed: [created.config.id],
      appHotkeyFailed: false,
    });

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code });
    // Last call restores the previous, known-good binding — not a clear.
    expect(hotkeysStore.setHotkeyBinding).toHaveBeenLastCalledWith(
      created.config.id,
      'CommandOrControl+Alt+9',
    );
    expect(hotkeysStore.clearHotkeyBinding).not.toHaveBeenCalled();
    // Re-synced once to apply the attempt, once more to restore.
    expect(hotkeyService.syncHotkeys).toHaveBeenCalledTimes(2);
  });

  it('rolls back to NO binding when there was none before and the new one fails', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');
    vi.mocked(hotkeysStore.getHotkeyBinding).mockReturnValue(undefined);
    vi.mocked(hotkeyService.syncHotkeys).mockReturnValueOnce({
      failed: [created.config.id],
      appHotkeyFailed: false,
    });

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code });
    expect(hotkeysStore.clearHotkeyBinding).toHaveBeenCalledWith(created.config.id);
  });

  it('rejects a combo already bound to the app-level "Save current workspace" hotkey, without touching the store', async () => {
    const created = await createWorkspace({ name: 'Hotkey target', steps: [] });
    if (!created.success) throw new Error('setup failed');
    vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReturnValue(
      'CommandOrControl+Alt+1',
    );

    const result = await setWorkspaceHotkey(created.config.id, 'CommandOrControl+Alt+1');

    // Electron's globalShortcut.register() never reports a same-process
    // double-registration as a failure — this cross-store collision can
    // ONLY be caught by this explicit, named-up-front check, never by
    // syncHotkeys()'s own OS-level failure detection.
    expect(result).toEqual({
      success: false,
      error: 'Already bound to "Save current workspace".',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    });
    expect(hotkeysStore.setHotkeyBinding).not.toHaveBeenCalled();
  });
});

describe('clearWorkspaceHotkey', () => {
  it('throws for a non-string/empty workspace id', () => {
    expect(() => clearWorkspaceHotkey(123)).toThrow(/workspace id/);
  });

  it('clears the binding and re-syncs', () => {
    clearWorkspaceHotkey('ws-1');
    expect(hotkeysStore.clearHotkeyBinding).toHaveBeenCalledWith('ws-1');
    expect(hotkeyService.syncHotkeys).toHaveBeenCalled();
  });
});

describe('setAppHotkey', () => {
  it('rejects a malformed accelerator without ever touching the store', async () => {
    const result = await setAppHotkey('not a real accelerator');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_INVALID.code });
    expect(appHotkeysStore.setSaveCurrentWorkspaceHotkey).not.toHaveBeenCalled();
  });

  it('allows a Shift-containing combo — there is no derived variant to reserve it for', async () => {
    const result = await setAppHotkey('CommandOrControl+Shift+S');
    expect(result).toEqual({ success: true });
  });

  it('persists and syncs a well-formed combo', async () => {
    const result = await setAppHotkey('CommandOrControl+Alt+S');

    expect(result).toEqual({ success: true });
    expect(appHotkeysStore.setSaveCurrentWorkspaceHotkey).toHaveBeenCalledWith(
      'CommandOrControl+Alt+S',
    );
    expect(hotkeyService.syncHotkeys).toHaveBeenCalled();
  });

  it('rejects a combo already bound to a workspace, naming it, without touching the store', async () => {
    const existing = await createWorkspace({ name: 'Existing workspace', steps: [] });
    if (!existing.success) throw new Error('setup failed');
    vi.mocked(hotkeysStore.getAllHotkeyBindings).mockReturnValue({
      [existing.config.id]: 'CommandOrControl+Alt+S',
    });

    const result = await setAppHotkey('CommandOrControl+Alt+S');

    expect(result).toEqual({
      success: false,
      error: 'Already bound to "Existing workspace".',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    });
    expect(appHotkeysStore.setSaveCurrentWorkspaceHotkey).not.toHaveBeenCalled();
  });

  it('rolls back to the PREVIOUS binding when the new one fails to register', async () => {
    vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReturnValue(
      'CommandOrControl+Alt+9',
    );
    vi.mocked(hotkeyService.syncHotkeys).mockReturnValueOnce({ failed: [], appHotkeyFailed: true });

    const result = await setAppHotkey('CommandOrControl+Alt+S');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code });
    expect(appHotkeysStore.setSaveCurrentWorkspaceHotkey).toHaveBeenLastCalledWith(
      'CommandOrControl+Alt+9',
    );
    expect(appHotkeysStore.clearSaveCurrentWorkspaceHotkey).not.toHaveBeenCalled();
    expect(hotkeyService.syncHotkeys).toHaveBeenCalledTimes(2);
  });

  it('rolls back to NO binding when there was none before and the new one fails', async () => {
    vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReturnValue(undefined);
    vi.mocked(hotkeyService.syncHotkeys).mockReturnValueOnce({ failed: [], appHotkeyFailed: true });

    const result = await setAppHotkey('CommandOrControl+Alt+S');

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code });
    expect(appHotkeysStore.clearSaveCurrentWorkspaceHotkey).toHaveBeenCalled();
  });
});

describe('clearAppHotkey / getAppHotkey', () => {
  it('clears the binding and re-syncs', () => {
    clearAppHotkey();
    expect(appHotkeysStore.clearSaveCurrentWorkspaceHotkey).toHaveBeenCalled();
    expect(hotkeyService.syncHotkeys).toHaveBeenCalled();
  });

  it('reads through to the store', () => {
    vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReturnValue(
      'CommandOrControl+Alt+S',
    );
    expect(getAppHotkey()).toBe('CommandOrControl+Alt+S');
  });
});

describe('detectCurrentWorkspace', () => {
  it('delegates to workspace-detection.ts unchanged', async () => {
    const result = await detectCurrentWorkspace();
    expect(result).toEqual({ status: 'ready', steps: [], unmatched: [], issues: [] });
  });
});

describe('markWorkspaceActive', () => {
  it('throws for a non-string/empty workspace id', () => {
    expect(() => markWorkspaceActive(123)).toThrow(/workspace id/);
    expect(() => markWorkspaceActive('')).toThrow(/workspace id/);
  });

  it('sets intent active for the given id', () => {
    markWorkspaceActive('ws-1');
    expect(activityStore.setIntentActive).toHaveBeenCalledWith('ws-1', true);
  });
});

describe('getLaunchOnLogin', () => {
  it('reads the live OS state, not just the stored value', () => {
    vi.mocked(app.getLoginItemSettings).mockReturnValue({ openAtLogin: true } as never);

    const result = getLaunchOnLogin();

    expect(result).toEqual({ success: true, enabled: true });
  });

  it('syncs the store to match the live OS state', () => {
    vi.mocked(app.getLoginItemSettings).mockReturnValue({ openAtLogin: true } as never);

    getLaunchOnLogin();

    expect(settingsStore.set).toHaveBeenCalledWith('launchOnLogin', true);
  });
});

describe('setLaunchOnLogin', () => {
  it('throws for a non-boolean value', () => {
    expect(() => setLaunchOnLogin('yes')).toThrow(/boolean/);
  });

  it('registers with the OS and persists on success', () => {
    const result = setLaunchOnLogin(true);

    expect(result).toEqual({ success: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(settingsStore.set).toHaveBeenCalledWith('launchOnLogin', true);
  });

  it('returns a structured failure (not a throw) if the OS call itself fails', () => {
    vi.mocked(app.setLoginItemSettings).mockImplementation(() => {
      throw new Error('not entitled');
    });

    const result = setLaunchOnLogin(true);

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.LAUNCH_ON_LOGIN_FAILED.code });
  });

  it('refuses to turn ON in an unpackaged dev build, without touching the OS at all', () => {
    setAppPackaged(false);

    const result = setLaunchOnLogin(true);

    expect(result).toMatchObject({ success: false, code: ERROR_CODES.LAUNCH_ON_LOGIN_FAILED.code });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('still allows turning OFF in a dev build — cleans up a login item registered before this guard existed', () => {
    setAppPackaged(false);

    const result = setLaunchOnLogin(false);

    expect(result).toEqual({ success: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });
});

describe('listWorkspaces', () => {
  it('includes a freshly created real workspace', async () => {
    await createWorkspace({ name: 'Real one', steps: [] });
    const all = await listWorkspaces();
    expect(all.some((ws) => ws.name === 'Real one')).toBe(true);
  });

  it('logs, but does not throw, when a persisted config file is unreadable', async () => {
    const dir = join(testUserDataDir, 'workspaces');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{ not json');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(listWorkspaces()).resolves.toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  describe('active', () => {
    beforeEach(() => {
      vi.mocked(processControl.isAppRunning).mockReset().mockResolvedValue(false);
      vi.mocked(activityStore.isIntentActive).mockReset().mockReturnValue(false);
    });

    it('is false for a workspace that was never intent-activated, even if it is still running', async () => {
      const created = await createWorkspace({
        name: 'VSC',
        steps: [{ type: 'vscode', params: { path: '~/x' } }],
      });
      if (!created.success) throw new Error('setup failed: ' + created.error);
      // Nothing marks it intent-active here.
      vi.mocked(processControl.isAppRunning).mockImplementation(
        async (name) => name === 'Visual Studio Code',
      );

      const all = await listWorkspaces();
      expect(all.find((ws) => ws.id === created.config.id)?.active).toBeFalsy();
    });

    it('is true only when intent-active AND something it needs is actually running', async () => {
      const created = await createWorkspace({
        name: 'VSC',
        steps: [{ type: 'vscode', params: { path: '~/x' } }],
      });
      if (!created.success) throw new Error('setup failed: ' + created.error);
      vi.mocked(activityStore.isIntentActive).mockImplementation(
        (id: string) => id === created.config.id,
      );
      vi.mocked(processControl.isAppRunning).mockImplementation(
        async (name) => name === 'Visual Studio Code',
      );

      const all = await listWorkspaces();
      expect(all.find((ws) => ws.id === created.config.id)?.active).toBe(true);
    });

    it('never shows active a workspace that merely shares a no-target tool with an active one', async () => {
      // Two workspaces both using spotify, which has no distinguishing
      // target — both "running" Spotify must never make the one that
      // was never itself restored/switched-to appear active.
      const active = await createWorkspace({ name: 'A', steps: [{ type: 'spotify', params: {} }] });
      if (!active.success) throw new Error('setup failed: ' + active.error);
      const neverTouched = await createWorkspace({
        name: 'B (never touched)',
        steps: [{ type: 'spotify', params: {} }],
      });
      if (!neverTouched.success) throw new Error('setup failed: ' + neverTouched.error);

      vi.mocked(activityStore.isIntentActive).mockImplementation(
        (id: string) => id === active.config.id,
      );
      vi.mocked(processControl.isAppRunning).mockImplementation(async (name) => name === 'Spotify');

      const all = await listWorkspaces();
      expect(all.find((ws) => ws.id === neverTouched.config.id)?.active).toBeFalsy();
    });

    // The non-macOS guard (SUPPORTS_WORKSPACE_ACTIVITY) is a module-level
    // constant computed at import time from process.platform — testing
    // the other branch would need vi.resetModules() plus a fresh import,
    // which would rebind processControl/activityStore to new mock
    // instances distinct from the ones asserted on here. Not worth the
    // fragility for a one-line early return; verified by inspection
    // instead (apps/desktop/src/main/ipc/handlers.ts's
    // SUPPORTS_WORKSPACE_ACTIVITY and every guarded call site).
  });
});

describe('registerIpcHandlers — app:getIcon', () => {
  function getRegisteredAppIconHandler(): (
    event: unknown,
    appPath: unknown,
  ) => Promise<string | null> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'app:getIcon');
    if (!call) throw new Error('app:getIcon was never registered');
    return call[1] as never;
  }

  it("returns getAppIconDataUrl's result unchanged on success", async () => {
    vi.mocked(getAppIconDataUrl).mockResolvedValueOnce('data:image/png;base64,abc123');
    const handler = getRegisteredAppIconHandler();

    const result = await handler({}, '/Applications/Figma.app');

    expect(result).toBe('data:image/png;base64,abc123');
    expect(getAppIconDataUrl).toHaveBeenCalledWith('/Applications/Figma.app');
  });

  it('returns null for a non-string path, without calling getAppIconDataUrl', async () => {
    const handler = getRegisteredAppIconHandler();

    expect(await handler({}, 123)).toBeNull();
    expect(getAppIconDataUrl).not.toHaveBeenCalled();
  });

  it('returns null for an empty string path, without calling getAppIconDataUrl', async () => {
    const handler = getRegisteredAppIconHandler();

    expect(await handler({}, '')).toBeNull();
    expect(getAppIconDataUrl).not.toHaveBeenCalled();
  });

  it('passes through a null result (extraction failed) unchanged', async () => {
    vi.mocked(getAppIconDataUrl).mockResolvedValueOnce(null);
    const handler = getRegisteredAppIconHandler();

    expect(await handler({}, '/Applications/Gone.app')).toBeNull();
  });
});

describe('registerIpcHandlers — app-level hotkey + detectCurrent channels', () => {
  function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
    registerIpcHandlers();
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
    if (!call) throw new Error(`${channel} was never registered`);
    return call[1] as never;
  }

  it('wires hotkeys:getAppHotkey to getAppHotkey', async () => {
    vi.mocked(appHotkeysStore.getSaveCurrentWorkspaceHotkey).mockReturnValue(
      'CommandOrControl+Alt+S',
    );
    const handler = getRegisteredHandler('hotkeys:getAppHotkey');
    expect(await handler({})).toBe('CommandOrControl+Alt+S');
  });

  it('wires hotkeys:setAppHotkey to setAppHotkey', async () => {
    const handler = getRegisteredHandler('hotkeys:setAppHotkey');
    const result = await handler({}, 'CommandOrControl+Alt+S');
    expect(result).toEqual({ success: true });
    expect(appHotkeysStore.setSaveCurrentWorkspaceHotkey).toHaveBeenCalledWith(
      'CommandOrControl+Alt+S',
    );
  });

  it('wires hotkeys:clearAppHotkey to clearAppHotkey', async () => {
    const handler = getRegisteredHandler('hotkeys:clearAppHotkey');
    await handler({});
    expect(appHotkeysStore.clearSaveCurrentWorkspaceHotkey).toHaveBeenCalled();
  });

  it('wires hotkeys:getAppHotkeyFailed to getAppHotkeyFailed', async () => {
    vi.mocked(hotkeyService.getAppHotkeyFailed).mockReturnValue(true);
    const handler = getRegisteredHandler('hotkeys:getAppHotkeyFailed');
    expect(await handler({})).toBe(true);
  });

  it('wires workspaces:detectCurrent to detectCurrentWorkspaceDraft', async () => {
    const handler = getRegisteredHandler('workspaces:detectCurrent');
    expect(await handler({})).toEqual({ status: 'ready', steps: [], unmatched: [], issues: [] });
  });

  it('wires workspaces:markActive to markWorkspaceActive', async () => {
    const handler = getRegisteredHandler('workspaces:markActive');
    await handler({}, 'ws-1');
    expect(activityStore.setIntentActive).toHaveBeenCalledWith('ws-1', true);
  });
});
