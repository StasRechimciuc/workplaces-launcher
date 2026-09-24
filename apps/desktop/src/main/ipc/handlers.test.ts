import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESTORE_PROGRESS_CHANNEL } from '@workspace-launcher/shared';
import { ipcMain } from 'electron';
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  registerIpcHandlers,
  restoreWorkspace,
  updateWorkspace,
} from './handlers';
import { registerBuiltInTools } from '../tools';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

// step-timing-history.ts (used by the orchestrator this transitively
// calls into) is backed by electron-store, which needs a real
// Electron `app` — unavailable under Vitest. See
// orchestrator.test.ts/step-timing-history.test.ts for the same mock
// and where that module's own logic is actually tested.
vi.mock('../orchestrator/step-timing-history', () => ({
  getStepTimeoutMs: () => 5000,
  recordSuccessfulStepDuration: () => {},
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
};

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataDir,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWin),
  },
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openInApp = vi.fn();
const openUrlInBrowserProfile = vi.fn();

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
  mockedGetPlatformLauncher.mockReset().mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile,
  });
  mockWin.isDestroyed.mockReset().mockReturnValue(false);
  mockWin.isMinimized.mockReset().mockReturnValue(false);
  mockWin.setAlwaysOnTop.mockReset();
  mockWin.moveTop.mockReset();
  mockWin.focus.mockReset();
  vi.mocked(ipcMain.handle).mockReset();
});

afterEach(async () => {
  await rm(testUserDataDir, { recursive: true, force: true });
});

describe('restoreWorkspace', () => {
  it('throws for a non-string workspace id', async () => {
    await expect(restoreWorkspace(123)).rejects.toThrow(/workspace id/);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(restoreWorkspace('does-not-exist')).rejects.toThrow(/No workspace found/);
  });

  it("runs a known mock workspace's steps through the orchestrator", async () => {
    const results = await restoreWorkspace('client-a');

    // client-a has 6 mock steps: vscode/chrome/spotify (registered) +
    // docker/terminal/slack (no plugin built yet).
    expect(results).toHaveLength(6);
    // vscode's path + spotify's playlist both go through openInApp.
    expect(openInApp).toHaveBeenCalledTimes(2);
    // chrome's one configured url.
    expect(openUrlInBrowserProfile).toHaveBeenCalledTimes(1);
  });

  it('runs the registered vscode step as a real success, not a stub', async () => {
    const results = await restoreWorkspace('client-a');
    expect(results[0]).toMatchObject({ success: true });
  });

  it('reports a not-yet-built tool type as a failed step, not a crash', async () => {
    const results = await restoreWorkspace('client-a');
    const dockerResult = results[1];
    expect(dockerResult?.success).toBe(false);
    expect(dockerResult?.message).toContain('docker');
  });

  it('restores a real saved workspace loaded from disk, not just the mock ones', async () => {
    const created = await createWorkspace({
      name: 'Real one',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed: ' + created.error);

    const results = await restoreWorkspace(created.config.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ success: true });
  });

  it('calls the optional onProgress callback for the mock-workspace path', async () => {
    const onProgress = vi.fn();
    await restoreWorkspace('client-a', onProgress);

    // client-a has 6 steps — running + a final event per step.
    expect(onProgress).toHaveBeenCalledTimes(12);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'client-a', stepIndex: 0, status: 'running' }),
    );
  });

  it('calls the optional onProgress callback for a real saved-config path too', async () => {
    const created = await createWorkspace({
      name: 'Real one',
      steps: [{ type: 'vscode', params: { path: '~/real' } }],
    });
    if (!created.success) throw new Error('setup failed: ' + created.error);

    const onProgress = vi.fn();
    await restoreWorkspace(created.config.id, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: created.config.id, status: 'running' }),
    );
  });
});

describe('registerIpcHandlers — workspaces:restore progress + focus wiring', () => {
  function getRegisteredRestoreHandler(): (
    event: { sender: { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn> } },
    workspaceId: unknown,
  ) => Promise<unknown> {
    registerIpcHandlers();
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'workspaces:restore');
    if (!call) throw new Error('workspaces:restore was never registered');
    return call[1] as never;
  }

  it('pushes a progress event per step over the IPC channel and re-asserts window focus', async () => {
    const handler = getRegisteredRestoreHandler();
    const send = vi.fn();
    const event = { sender: { send, isDestroyed: vi.fn(() => false) } };

    const results = await handler(event, 'client-a');

    expect(results).toHaveLength(6);
    expect(send).toHaveBeenCalledTimes(12);
    expect(send.mock.calls[0]).toEqual([
      RESTORE_PROGRESS_CHANNEL,
      expect.objectContaining({ workspaceId: 'client-a', stepIndex: 0, status: 'running' }),
    ]);
    // Focus lifecycle: pinned at the start, re-asserted on the first
    // 'running' event, cleared once the whole restore has resolved.
    expect(mockWin.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(mockWin.moveTop).toHaveBeenCalled();
    expect(mockWin.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('never lets a destroyed webContents throw into the orchestrator, and still returns every result', async () => {
    const handler = getRegisteredRestoreHandler();
    const send = vi.fn(() => {
      throw new Error('Object has been destroyed');
    });
    const event = { sender: { send, isDestroyed: vi.fn(() => false) } };

    const results = await handler(event, 'client-a');

    // The exact failure mode the adversarial review caught: a throwing
    // send() must never abort the run or discard already-collected
    // results.
    expect(results).toHaveLength(6);
  });

  it('skips sending when the webContents is already destroyed, without throwing', async () => {
    const handler = getRegisteredRestoreHandler();
    const send = vi.fn();
    const event = { sender: { send, isDestroyed: vi.fn(() => true) } };

    const results = await handler(event, 'client-a');

    expect(results).toHaveLength(6);
    expect(send).not.toHaveBeenCalled();
  });

  it('never lets a throwing focus reassert abort the restore either', async () => {
    // The first moveTop() call is startRestoreFocusSession's own
    // begin() — let that succeed, and only fail the calls reassert()
    // makes per step, isolating the specific try/catch this test is
    // for from the (separately unguarded) begin() call.
    mockWin.moveTop.mockImplementationOnce(() => {}).mockImplementation(() => {
      throw new Error('native window error');
    });
    const handler = getRegisteredRestoreHandler();
    const event = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } };

    const results = await handler(event, 'client-a');

    // Same failure class as the destroyed-webContents case above, but
    // for restore-focus.ts's moveTop()/focus() calls instead of send().
    expect(results).toHaveLength(6);
  });
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
    }
  });

  it('allows a step type with no registered tool yet (e.g. docker), unvalidated', async () => {
    const result = await createWorkspace({
      name: 'My workspace',
      steps: [{ type: 'docker', params: {} }],
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

  it('rejects editing a mock workspace with a specific, honest message', async () => {
    const result = await updateWorkspace({ id: 'client-a', name: 'Hacked', steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("can't be edited");
  });

  it('rejects an unknown workspace id', async () => {
    const result = await updateWorkspace({ id: 'does-not-exist', name: 'X', steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/No workspace found/);
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
    if (!result.success) expect(result.error).toContain('path');
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

  it('rejects deleting a mock workspace with a specific, honest message', async () => {
    const result = await deleteWorkspace('client-a');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("can't be deleted");
  });

  it('rejects an unknown workspace id', async () => {
    const result = await deleteWorkspace('does-not-exist');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/No workspace found/);
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
    expect(all.some((ws) => ws.id === 'client-a')).toBe(true);
  });

  it('reports "No workspace found" (not a silent no-op) on a second delete of the same id', async () => {
    const created = await createWorkspace({ name: 'To delete', steps: [] });
    if (!created.success) throw new Error('setup failed');
    await deleteWorkspace(created.config.id);

    const second = await deleteWorkspace(created.config.id);
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error).toMatch(/No workspace found/);
  });
});

describe('listWorkspaces', () => {
  it('includes a freshly created real workspace alongside the mock ones', async () => {
    await createWorkspace({ name: 'Real one', steps: [] });
    const all = await listWorkspaces();
    expect(all.some((ws) => ws.name === 'Real one')).toBe(true);
    expect(all.some((ws) => ws.id === 'client-a')).toBe(true);
  });

  it('tags real workspaces as not read-only and mock workspaces as read-only', async () => {
    await createWorkspace({ name: 'Real one', steps: [] });
    const all = await listWorkspaces();
    const real = all.find((ws) => ws.name === 'Real one');
    const mock = all.find((ws) => ws.id === 'client-a');
    expect(real?.readOnly).toBeFalsy();
    expect(mock?.readOnly).toBe(true);
  });

  it('lists real workspaces before the mock ones', async () => {
    await createWorkspace({ name: 'Real one', steps: [] });
    const all = await listWorkspaces();
    const realIndex = all.findIndex((ws) => ws.name === 'Real one');
    const mockIndex = all.findIndex((ws) => ws.id === 'client-a');
    expect(realIndex).toBeLessThan(mockIndex);
  });

  it('prefers a real persisted config over a mock workspace sharing the same id', async () => {
    // Not reachable via createWorkspace (always mints a fresh
    // randomUUID()) — simulates a hand-placed/imported config file
    // that happens to reuse one of the hardcoded mock ids.
    const dir = join(testUserDataDir, 'workspaces');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'client-a.json'),
      JSON.stringify({ version: 1, id: 'client-a', name: 'Real client-a', steps: [] }),
    );

    const all = await listWorkspaces();
    const matches = all.filter((ws) => ws.id === 'client-a');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe('Real client-a');
    expect(matches[0]?.readOnly).toBeFalsy();
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
});
