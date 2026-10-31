import { beforeEach, describe, expect, it } from 'vitest';
import type { WindowHeartbeat } from '@workspace-launcher/shared/vscode-restore';
import type { WindowCommandAck } from '@workspace-launcher/shared/vscode-window-commands';
import { bundlePathOfAppRoot, createVscodeWindowKind } from './vscode-window-kind';
import { vscodeWindowResource } from './vscode-window-spec';

// A scripted world: which windows heartbeat, whether VS Code runs, and
// how a window answers a close request.
const APP_ROOT = '/Applications/Visual Studio Code.app/Contents/Resources/app';
let beats: WindowHeartbeat[] = [];
let vscodeRunning: boolean | null = true;
let answer: WindowCommandAck['status'] | 'silent' | 'late' = 'ok';
/** 'late': the window claimed the command, and answers only after the app's wait. */
let lateAckAfter = 0;
const withdrawn: string[] = [];
const cleaned: string[] = [];
let answerReason: WindowCommandAck['reason'] | undefined;
const sent: string[] = [];
const openedFolders: string[] = [];

const kind = createVscodeWindowKind(
  {
    listHeartbeats: async () => beats,
    bundleIdOfAppRoot: async (root) => (root === APP_ROOT ? 'com.microsoft.VSCode' : 'other'),
    isAppRunning: async () => vscodeRunning,
    openFolder: async (_bundleId, folder) => {
      openedFolders.push(folder);
      return null;
    },
    sendClose: async (sessionId) => {
      sent.push(sessionId);
      if (answer === 'ok')
        beats = beats.filter((b) => b.version !== 2 || b.sessionId !== sessionId);
      return 'cmd-1';
    },
    readAck: async (id) => {
      if (answer === 'silent') return undefined;
      if (answer === 'late') {
        if (Date.now() < lateAckAfter) return undefined;
        beats = [];
        return { version: 1, id, status: 'ok' };
      }
      return { version: 1, id, status: answer, ...(answerReason ? { reason: answerReason } : {}) };
    },
    // A silent window never claimed it, so it can be taken back; a late one already has.
    withdraw: async (id) => {
      withdrawn.push(id);
      return answer === 'silent';
    },
    cleanUp: async (id) => {
      cleaned.push(id);
    },
  },
  { ackTimeoutMs: 50, closeTimeoutMs: 50, claimedGraceMs: 200, pollMs: 5 },
);

const spec = vscodeWindowResource('com.microsoft.VSCode', '/work/app/');

function beat(
  sessionId: string,
  activatedAt: number,
  overrides: Partial<WindowHeartbeat> = {},
): WindowHeartbeat {
  return {
    version: 2,
    folderPath: '/work/app',
    updatedAt: new Date().toISOString(),
    sessionId,
    activatedAt: new Date(activatedAt).toISOString(),
    appRoot: APP_ROOT,
    folderCount: 1,
    ...overrides,
  } as WindowHeartbeat;
}

beforeEach(() => {
  beats = [];
  vscodeRunning = true;
  answer = 'ok';
  answerReason = undefined;
  sent.length = 0;
  openedFolders.length = 0;
  withdrawn.length = 0;
  cleaned.length = 0;
});

async function opened(): Promise<Record<string, unknown>> {
  const snapshot = await kind.snapshot(spec.identity);
  const captured = await kind.capture(spec.identity, snapshot);
  if (!captured.found) throw new Error('not captured');
  return captured.handle;
}

describe('vscode window kind', () => {
  it('identifies a window by app and normalized folder', () => {
    expect(spec).toEqual({
      kind: 'vscode-window',
      identity: { bundleId: 'com.microsoft.VSCode', folder: '/work/app' },
      label: 'VS Code (app)',
      appName: 'Visual Studio Code',
    });
  });

  it('captures without waiting, and binds the window lazily once its extension reports', async () => {
    const handle = await opened();
    expect(handle).toMatchObject({ sessionId: null });
    beats = [beat('s-new', Date.now() + 500)];
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({
      state: 'alive',
      handle: { ...handle, sessionId: 's-new' },
    });
  });

  it('treats a window already open on the folder as the user’s', async () => {
    beats = [beat('s-old', Date.now() - 60_000)];
    const snapshot = await kind.snapshot(spec.identity);
    await expect(kind.capture(spec.identity, snapshot)).resolves.toMatchObject({
      preexisting: true,
    });
  });

  it('ignores other folders, other VS Code-family apps, multi-root and v1 windows', async () => {
    const handle = await opened();
    beats = [
      beat('a', Date.now() + 1, { folderPath: '/work/other' }),
      beat('b', Date.now() + 1, { appRoot: '/Applications/Cursor.app/Contents/Resources/app' }),
      beat('c', Date.now() + 1, { folderCount: 2 } as Partial<WindowHeartbeat>),
      { version: 1, folderPath: '/work/app', updatedAt: new Date().toISOString() },
    ];
    await expect(kind.check(handle, spec.identity)).resolves.toMatchObject({ state: 'unknown' });
  });

  it('is gone when the bound window is, or the folder was reopened in a new window', async () => {
    const bound = { ...(await opened()), sessionId: 's-1' };
    beats = [beat('s-1', Date.now())];
    await expect(kind.check(bound, spec.identity)).resolves.toEqual({ state: 'alive' });
    beats = [beat('s-2', Date.now())];
    await expect(kind.check(bound, spec.identity)).resolves.toEqual({ state: 'gone' });
    beats = [];
    await expect(kind.check(bound, spec.identity)).resolves.toEqual({ state: 'gone' });
  });

  it('without any report: gone if VS Code is closed, unsure if it’s running', async () => {
    const handle = await opened();
    await expect(kind.check(handle, spec.identity)).resolves.toMatchObject({ state: 'unknown' });
    vscodeRunning = false;
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'gone' });
  });

  it('brings its open window forward by opening its folder — VS Code raises that window', async () => {
    const handle = await opened();
    beats = [beat('s-new', Date.now() + 100)];
    await expect(kind.focus!(handle)).resolves.toBeNull();
    expect(openedFolders).toEqual(['/work/app']);
  });

  it('never opens a window that isn’t open any more just to bring it forward', async () => {
    const handle = { ...(await opened()), sessionId: 's-1' };
    beats = [];
    vscodeRunning = false;
    await expect(kind.focus!(handle)).resolves.toContain("isn't open");
    expect(openedFolders).toEqual([]);
  });

  it('closes just its window through the extension', async () => {
    const handle = await opened();
    beats = [beat('s-new', Date.now() + 100)];
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(sent).toEqual(['s-new']);
  });

  it('never quits VS Code without the extension — leaves it open and says why', async () => {
    const handle = await opened();
    await expect(kind.close(handle)).resolves.toEqual({
      outcome: 'kept-running',
      detail: expect.stringContaining('needs the Workspace Launcher VS Code extension'),
    });
    expect(sent).toEqual([]);
  });

  it('reports a window that refused (unsaved changes) or never answered', async () => {
    const handle = { ...(await opened()), sessionId: 's-1' };
    beats = [beat('s-1', Date.now())];
    answer = 'refused';
    answerReason = 'unsaved';
    await expect(kind.close(handle)).resolves.toEqual({
      outcome: 'refused',
      detail: 'it has unsaved changes',
    });
    answer = 'silent';
    await expect(kind.close(handle)).resolves.toMatchObject({ outcome: 'failed' });
    // Taken back, so the window can never act on it late.
    expect(withdrawn).toEqual(['cmd-1']);
  });

  it('waits for the answer of a window that claimed the request just before the timeout', async () => {
    const handle = await opened();
    beats = [beat('s-new', Date.now() + 100)];
    answer = 'late';
    lateAckAfter = Date.now() + 100;
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(cleaned).toEqual(['cmd-1']);
  });
});

describe('bundlePathOfAppRoot', () => {
  it('finds the .app bundle an appRoot lives in', () => {
    expect(bundlePathOfAppRoot(APP_ROOT)).toBe('/Applications/Visual Studio Code.app');
    expect(bundlePathOfAppRoot('/opt/code/resources/app')).toBeNull();
  });
});
