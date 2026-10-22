import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow, globalShortcut, Notification } from 'electron';
import { getAllHotkeyBindings } from './workspace-hotkeys-store';
import { getSaveCurrentWorkspaceHotkey } from './app-hotkeys-store';
import { getWorkspaceName, restoreWorkspaceWithFocus, switchWorkspace } from '../ipc/handlers';
import {
  getAppHotkeyFailed,
  getFailedHotkeyBindings,
  registerShowMainWindow,
  syncHotkeys,
} from './hotkey-service';

vi.mock('./workspace-hotkeys-store', () => ({
  getAllHotkeyBindings: vi.fn(() => ({})),
}));

vi.mock('./app-hotkeys-store', () => ({
  getSaveCurrentWorkspaceHotkey: vi.fn(() => undefined),
}));

vi.mock('../ipc/handlers', () => ({
  restoreWorkspaceWithFocus: vi.fn(),
  switchWorkspace: vi.fn(),
  getWorkspaceName: vi.fn((id: string) => Promise.resolve(id)),
}));

// Simulates real globalShortcut semantics closely enough for this
// file's own logic to be meaningfully tested: register() can silently
// fail to actually claim a combo (another app/the OS already owns it)
// without throwing — detectable only via a follow-up isRegistered()
// check (see hotkey-service.ts's own doc comment on registerOne). The
// registry Map IS the simulated OS-level registration state.
let registry: Map<string, () => void>;
let conflictedAccelerators: Set<string>;
let throwingAccelerators: Set<string>;

vi.mock('electron', () => {
  // A vi.fn() (not a plain class) so `new Notification(...)` calls are
  // tracked and assertable via toHaveBeenCalledWith, same as any other
  // mocked function — a plain class here would construct real
  // instances vitest knows nothing about.
  const NotificationMock = vi.fn(function (this: { show: () => void }) {
    this.show = vi.fn();
  }) as unknown as { new (opts: { title: string; body: string }): { show: () => void } } & {
    isSupported: () => boolean;
  };
  (NotificationMock as unknown as { isSupported: ReturnType<typeof vi.fn> }).isSupported = vi.fn(
    () => true,
  );

  return {
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    globalShortcut: {
      register: vi.fn(),
      unregister: vi.fn(),
      unregisterAll: vi.fn(),
      isRegistered: vi.fn(),
    },
    Notification: NotificationMock,
  };
});

beforeEach(() => {
  registry = new Map();
  conflictedAccelerators = new Set();
  throwingAccelerators = new Set();

  vi.mocked(globalShortcut.register).mockImplementation((accelerator, callback) => {
    if (throwingAccelerators.has(accelerator)) {
      throw new Error(`Electron rejected accelerator "${accelerator}"`);
    }
    if (conflictedAccelerators.has(accelerator)) {
      return false; // simulates the OS silently refusing — register()'s own documented behavior
    }
    registry.set(accelerator, callback as () => void);
    return true;
  });
  vi.mocked(globalShortcut.unregister).mockImplementation((accelerator) => {
    registry.delete(accelerator);
  });
  vi.mocked(globalShortcut.unregisterAll).mockImplementation(() => {
    registry.clear();
  });
  vi.mocked(globalShortcut.isRegistered).mockImplementation((accelerator) => registry.has(accelerator));

  vi.mocked(getAllHotkeyBindings).mockReset().mockReturnValue({});
  vi.mocked(getSaveCurrentWorkspaceHotkey).mockReset().mockReturnValue(undefined);
  vi.mocked(restoreWorkspaceWithFocus).mockReset().mockResolvedValue([]);
  vi.mocked(switchWorkspace)
    .mockReset()
    .mockResolvedValue({ stepResults: [], closed: [], leftOpen: [] });
  vi.mocked(getWorkspaceName).mockReset().mockImplementation((id: string) => Promise.resolve(id));
  vi.mocked(Notification.isSupported).mockReset().mockReturnValue(true);
  vi.mocked(Notification).mockClear();
  vi.mocked(BrowserWindow.getAllWindows).mockReset().mockReturnValue([]);
});

function fireAccelerator(accelerator: string): void {
  const callback = registry.get(accelerator);
  if (!callback) throw new Error(`Test error: "${accelerator}" was never registered.`);
  callback();
}

describe('syncHotkeys', () => {
  it('registers nothing and reports no failures when there are no bindings', () => {
    expect(syncHotkeys()).toEqual({ failed: [], appHotkeyFailed: false });
    expect(globalShortcut.unregisterAll).toHaveBeenCalled();
  });

  it('registers both the base combo and its Shift-derived Switch variant', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });

    const { failed } = syncHotkeys();

    expect(failed).toEqual([]);
    expect(registry.has('CommandOrControl+Alt+1')).toBe(true);
    expect(registry.has('CommandOrControl+Alt+1+Shift')).toBe(true);
  });

  it('never leaves a workspace with only one half registered — rolls back the other if either fails', () => {
    conflictedAccelerators.add('CommandOrControl+Alt+1+Shift'); // simulates another app owning it
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });

    const { failed } = syncHotkeys();

    expect(failed).toEqual(['ws-1']);
    // The base DID successfully register with the OS, then must be
    // explicitly unregistered again since its Shift pair failed.
    expect(globalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+1');
    expect(registry.has('CommandOrControl+Alt+1')).toBe(false);
    expect(registry.has('CommandOrControl+Alt+1+Shift')).toBe(false);
  });

  it('one bad binding never aborts registering every other workspace\'s hotkeys', () => {
    throwingAccelerators.add('CommandOrControl+Alt+2');
    vi.mocked(getAllHotkeyBindings).mockReturnValue({
      'ws-bad': 'CommandOrControl+Alt+2',
      'ws-good': 'CommandOrControl+Alt+3',
    });

    const { failed } = syncHotkeys();

    expect(failed).toEqual(['ws-bad']);
    expect(registry.has('CommandOrControl+Alt+3')).toBe(true);
    expect(registry.has('CommandOrControl+Alt+3+Shift')).toBe(true);
  });

  it('skips a malformed stored binding without ever calling register() for it', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-corrupt': 'not a real accelerator' });

    const { failed } = syncHotkeys();

    expect(failed).toEqual(['ws-corrupt']);
    expect(globalShortcut.register).not.toHaveBeenCalledWith('not a real accelerator', expect.anything());
  });

  it('rejects a stored binding that already contains Shift (reserved for the derived Switch variant)', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-shift': 'CommandOrControl+Shift+1' });

    const { failed } = syncHotkeys();

    expect(failed).toEqual(['ws-shift']);
  });

  it('getFailedHotkeyBindings reflects the most recent sync, not a stale earlier one', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();
    expect(getFailedHotkeyBindings()).toEqual([]);

    conflictedAccelerators.add('CommandOrControl+Alt+1+Shift');
    syncHotkeys();
    expect(getFailedHotkeyBindings()).toEqual(['ws-1']);
  });
});

describe('hotkey trigger callbacks', () => {
  it('firing the base accelerator restores the workspace', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1');

    expect(restoreWorkspaceWithFocus).toHaveBeenCalledWith('ws-1', null);
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('firing the Shift variant switches to the workspace instead', () => {
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1+Shift');

    expect(switchWorkspace).toHaveBeenCalledWith('ws-1');
    expect(restoreWorkspaceWithFocus).not.toHaveBeenCalled();
  });

  it('ignores a second press for the same workspace while the first is still running (debounce)', async () => {
    let resolveFirst!: (value: never[]) => void;
    vi.mocked(restoreWorkspaceWithFocus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1'); // starts, never resolves yet
    fireAccelerator('CommandOrControl+Alt+1'); // should be ignored — still in flight

    expect(restoreWorkspaceWithFocus).toHaveBeenCalledTimes(1);

    resolveFirst([]);
    await Promise.resolve();
    await Promise.resolve();

    fireAccelerator('CommandOrControl+Alt+1'); // now allowed again
    expect(restoreWorkspaceWithFocus).toHaveBeenCalledTimes(2);
  });

  it('shows a failure notification when a triggered restore reports a failed step', async () => {
    vi.mocked(restoreWorkspaceWithFocus).mockResolvedValueOnce([
      { success: false, message: 'Something broke', durationMs: 10 },
    ]);
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(Notification).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Something broke' }),
    );
  });

  it('shows no notification on an all-successful triggered restore', async () => {
    vi.mocked(restoreWorkspaceWithFocus).mockResolvedValueOnce([
      { success: true, message: 'ok', durationMs: 10 },
    ]);
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(Notification).not.toHaveBeenCalled();
  });

  it('shows a failure notification when the triggered action itself throws', async () => {
    vi.mocked(restoreWorkspaceWithFocus).mockRejectedValueOnce(new Error('orchestrator exploded'));
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+1');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(Notification).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'orchestrator exploded' }),
    );
  });
});

describe('app-level "Save current workspace" hotkey', () => {
  it('registers the app hotkey in the same pass as the per-workspace ones', () => {
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Alt+S');

    const { appHotkeyFailed } = syncHotkeys();

    expect(appHotkeyFailed).toBe(false);
    expect(registry.has('CommandOrControl+Alt+S')).toBe(true);
  });

  it('allows Shift in the app hotkey itself — there is no derived variant to reserve it for', () => {
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Shift+S');

    const { appHotkeyFailed } = syncHotkeys();

    expect(appHotkeyFailed).toBe(false);
    expect(registry.has('CommandOrControl+Shift+S')).toBe(true);
  });

  it('reports appHotkeyFailed, not the workspace-keyed failed[] array, when the app hotkey collides at the OS level', () => {
    conflictedAccelerators.add('CommandOrControl+Alt+S');
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Alt+S');
    vi.mocked(getAllHotkeyBindings).mockReturnValue({ 'ws-1': 'CommandOrControl+Alt+1' });

    const { failed, appHotkeyFailed } = syncHotkeys();

    expect(appHotkeyFailed).toBe(true);
    expect(failed).toEqual([]); // the unrelated workspace binding must be unaffected
  });

  it('skips a malformed stored app hotkey without calling register() for it', () => {
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('not a real accelerator');

    const { appHotkeyFailed } = syncHotkeys();

    expect(appHotkeyFailed).toBe(true);
    expect(globalShortcut.register).not.toHaveBeenCalledWith(
      'not a real accelerator',
      expect.anything(),
    );
  });

  it('getAppHotkeyFailed reflects the most recent sync, not a stale earlier one', () => {
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Alt+S');
    syncHotkeys();
    expect(getAppHotkeyFailed()).toBe(false);

    conflictedAccelerators.add('CommandOrControl+Alt+S');
    syncHotkeys();
    expect(getAppHotkeyFailed()).toBe(true);
  });

  it('firing the app hotkey shows/focuses the main window and notifies the renderer', () => {
    const showMainWindow = vi.fn();
    registerShowMainWindow(showMainWindow);
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow as never]);
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Alt+S');
    syncHotkeys();

    fireAccelerator('CommandOrControl+Alt+S');

    expect(showMainWindow).toHaveBeenCalled();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith('workspaces:save-current-triggered');
  });

  it('firing the app hotkey with no window open calls showMainWindow but never throws', () => {
    registerShowMainWindow(vi.fn());
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
    vi.mocked(getSaveCurrentWorkspaceHotkey).mockReturnValue('CommandOrControl+Alt+S');
    syncHotkeys();

    expect(() => fireAccelerator('CommandOrControl+Alt+S')).not.toThrow();
  });
});
