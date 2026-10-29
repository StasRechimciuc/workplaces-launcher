import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteWindowCommand,
  deleteWindowCommandAck,
  getWindowCommandsDir,
  readWindowCommandAck,
  readWindowCommands,
  WINDOW_COMMAND_TTL_MS,
  writeWindowCommand,
  writeWindowCommandAck,
} from './vscode-window-commands';
import { listWindowHeartbeats, writeCurrentWindowState } from './vscode-restore';

// Real files under a throwaway home directory — the app data dir is
// derived from homedir(), stubbed here the same way vscode-restore.test.ts does.
let fakeHomeDir: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHomeDir };
});

beforeEach(async () => {
  fakeHomeDir = await mkdtemp(join(tmpdir(), 'vscode-commands-test-home-'));
});

afterEach(async () => {
  await rm(fakeHomeDir, { recursive: true, force: true });
});

const activated = new Date(Date.now() - 1000);

describe('window commands', () => {
  it('delivers a command only to the window it was addressed to', async () => {
    const id = await writeWindowCommand('window-a', 'close');
    await expect(readWindowCommands('window-a', activated)).resolves.toEqual([
      expect.objectContaining({ id, sessionId: 'window-a', action: 'close' }),
    ]);
    await expect(readWindowCommands('window-b', activated)).resolves.toEqual([]);
  });

  it('ignores commands from before the window started, and expired ones', async () => {
    await writeWindowCommand('window-a', 'close');
    await expect(readWindowCommands('window-a', new Date(Date.now() + 1000))).resolves.toEqual([]);
    const later = new Date(Date.now() + WINDOW_COMMAND_TTL_MS + 1000);
    await expect(readWindowCommands('window-a', activated, later)).resolves.toEqual([]);
  });

  it('skips unreadable files instead of failing', async () => {
    await writeWindowCommand('window-a', 'close');
    await writeFile(join(getWindowCommandsDir(), 'cmd-broken.json'), '{ nope');
    await expect(readWindowCommands('window-a', activated)).resolves.toHaveLength(1);
  });

  it('round-trips an answer, and cleans up both files', async () => {
    const id = await writeWindowCommand('window-a', 'close');
    await expect(readWindowCommandAck(id)).resolves.toBeUndefined();
    await deleteWindowCommand(id);
    await writeWindowCommandAck(id, 'refused', 'unsaved');
    await expect(readWindowCommandAck(id)).resolves.toEqual({
      version: 1,
      id,
      status: 'refused',
      reason: 'unsaved',
    });
    await deleteWindowCommandAck(id);
    await deleteWindowCommandAck(id); // idempotent
    await expect(readdir(getWindowCommandsDir())).resolves.toEqual([]);
  });
});

describe('window heartbeats (v2)', () => {
  it('reports each live window with what identifies it', async () => {
    await writeCurrentWindowState('/work/app', {
      sessionId: 's-1',
      activatedAt: '2026-10-29T10:00:00.000Z',
      appRoot: '/Applications/Visual Studio Code.app/Contents/Resources/app',
      folderCount: 1,
    });
    await expect(listWindowHeartbeats()).resolves.toEqual([
      expect.objectContaining({ version: 2, folderPath: '/work/app', sessionId: 's-1' }),
    ]);
  });
});
