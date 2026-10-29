import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CURRENT_VSCODE_RESTORE_VERSION,
  CURRENT_WINDOW_STATE_HEARTBEAT_MS,
  deleteCurrentWindowState,
  deletePendingVscodeRestore,
  getCurrentWindowStateDir,
  getVscodeRestoreDir,
  listOpenWindowFolders,
  PRODUCT_NAME,
  readCurrentWindowState,
  readPendingVscodeRestore,
  writeCurrentWindowState,
  writePendingVscodeRestore,
} from './vscode-restore';

/** A v2 heartbeat's window details — fixed, so tests only vary what they're about. */
const WINDOW_DETAILS = {
  sessionId: 'session-1',
  activatedAt: '2026-10-29T10:00:00.000Z',
  appRoot: '/Applications/Visual Studio Code.app/Contents/Resources/app',
  folderCount: 1,
};

// vscode-restore.ts reads homedir() fresh on every call (not cached at
// import time), so — unlike windows/app-paths.ts's KNOWN_APP_PATHS —
// no vi.resetModules() is needed here; stubbing homedir/env/platform
// before each call is enough.
let fakeHomeDir: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => fakeHomeDir,
  };
});

const originalPlatform = process.platform;

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(async () => {
  fakeHomeDir = await mkdtemp(join(tmpdir(), 'vscode-restore-test-home-'));
  vi.unstubAllEnvs();
});

afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  await rm(fakeHomeDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('getVscodeRestoreDir', () => {
  it('uses APPDATA on win32 when set', () => {
    stubPlatform('win32');
    vi.stubEnv('APPDATA', 'C:\\Users\\dev\\AppData\\Roaming');
    expect(getVscodeRestoreDir()).toBe(
      join('C:\\Users\\dev\\AppData\\Roaming', PRODUCT_NAME, 'vscode-restore'),
    );
  });

  it('falls back to homedir()/AppData/Roaming on win32 when APPDATA is unset', () => {
    stubPlatform('win32');
    vi.stubEnv('APPDATA', undefined);
    expect(getVscodeRestoreDir()).toBe(
      join(fakeHomeDir, 'AppData', 'Roaming', PRODUCT_NAME, 'vscode-restore'),
    );
  });

  it('uses Library/Application Support on darwin', () => {
    stubPlatform('darwin');
    expect(getVscodeRestoreDir()).toBe(
      join(fakeHomeDir, 'Library', 'Application Support', PRODUCT_NAME, 'vscode-restore'),
    );
  });

  it('uses XDG_CONFIG_HOME on linux when set', () => {
    stubPlatform('linux');
    vi.stubEnv('XDG_CONFIG_HOME', '/home/dev/.config-custom');
    expect(getVscodeRestoreDir()).toBe(
      join('/home/dev/.config-custom', PRODUCT_NAME, 'vscode-restore'),
    );
  });

  it('falls back to homedir()/.config on linux when XDG_CONFIG_HOME is unset', () => {
    stubPlatform('linux');
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    expect(getVscodeRestoreDir()).toBe(
      join(fakeHomeDir, '.config', PRODUCT_NAME, 'vscode-restore'),
    );
  });

  it('throws for an unsupported platform', () => {
    stubPlatform('aix');
    expect(() => getVscodeRestoreDir()).toThrow(/Unsupported platform/);
  });
});

describe('writePendingVscodeRestore / readPendingVscodeRestore / deletePendingVscodeRestore', () => {
  beforeEach(() => {
    stubPlatform('darwin');
  });

  it('round-trips a written entry', async () => {
    await writePendingVscodeRestore('/Users/me/projects/client-a', {
      terminals: [{ commands: ['npm install', 'npm run dev'] }],
    });

    const result = await readPendingVscodeRestore('/Users/me/projects/client-a');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.entry.version).toBe(CURRENT_VSCODE_RESTORE_VERSION);
      expect(result.entry.terminals).toEqual([{ commands: ['npm install', 'npm run dev'] }]);
    }
  });

  it('reports "none" when nothing was ever staged for that folder', async () => {
    const result = await readPendingVscodeRestore('/Users/me/projects/never-restored');
    expect(result).toEqual({ status: 'none' });
  });

  it('matches the same folder regardless of a trailing slash', async () => {
    await writePendingVscodeRestore('/Users/me/projects/client-a/', {
      terminals: [{ commands: ['echo hi'] }],
    });
    const result = await readPendingVscodeRestore('/Users/me/projects/client-a');
    expect(result.status).toBe('found');
  });

  it('is case-insensitive on win32 only', async () => {
    stubPlatform('win32');
    vi.stubEnv('APPDATA', join(fakeHomeDir, 'AppData', 'Roaming'));
    await writePendingVscodeRestore('C:\\Projects\\Client-A', {
      terminals: [{ commands: ['echo hi'] }],
    });

    const sameCaseResult = await readPendingVscodeRestore('c:\\projects\\client-a');
    expect(sameCaseResult.status).toBe('found');
  });

  it('matches on win32 regardless of forward vs backward slashes', async () => {
    // The desktop app hashes whatever the user typed into the "path"
    // field (which may use forward slashes — the UI's own placeholder
    // text does), while the extension always hashes
    // folder.uri.fsPath, which VS Code reports with backslashes on
    // win32. Both must resolve to the same file.
    stubPlatform('win32');
    vi.stubEnv('APPDATA', join(fakeHomeDir, 'AppData', 'Roaming'));
    await writePendingVscodeRestore('C:/Projects/Client-A', {
      terminals: [{ commands: ['echo hi'] }],
    });

    const result = await readPendingVscodeRestore('C:\\Projects\\Client-A');
    expect(result.status).toBe('found');
  });

  it('is case-sensitive on darwin', async () => {
    await writePendingVscodeRestore('/Users/me/projects/Client-A', {
      terminals: [{ commands: ['echo hi'] }],
    });

    const differentCaseResult = await readPendingVscodeRestore('/Users/me/projects/client-a');
    expect(differentCaseResult.status).toBe('none');
  });

  it('reports "corrupt" for invalid JSON, without throwing', async () => {
    const dir = getVscodeRestoreDir();
    await writePendingVscodeRestore('/Users/me/projects/to-corrupt', {
      terminals: [{ commands: ['echo hi'] }],
    });
    const files = await readdir(dir);
    await writeFile(join(dir, files[0]!), '{ not json', 'utf-8');

    const result = await readPendingVscodeRestore('/Users/me/projects/to-corrupt');
    expect(result.status).toBe('corrupt');
  });

  it('reports "unsupported-version" for a version this build does not recognize, and leaves the file in place', async () => {
    await writePendingVscodeRestore('/Users/me/projects/future-version', {
      terminals: [{ commands: ['echo hi'] }],
    });
    const dir = getVscodeRestoreDir();
    const files = await readdir(dir);
    const filePath = join(dir, files[0]!);
    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    raw.version = 999;
    await writeFile(filePath, JSON.stringify(raw), 'utf-8');

    const result = await readPendingVscodeRestore('/Users/me/projects/future-version');
    expect(result).toMatchObject({ status: 'unsupported-version', version: 999 });

    // File must survive an unsupported-version read — a future
    // compatible version might still consume it within the TTL window.
    const stillThere = await access(filePath)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(true);
  });

  it('reports "expired" for an entry older than the TTL, without throwing', async () => {
    await writePendingVscodeRestore('/Users/me/projects/stale', {
      terminals: [{ commands: ['echo hi'] }],
    });
    const dir = getVscodeRestoreDir();
    const files = await readdir(dir);
    const filePath = join(dir, files[0]!);
    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    raw.createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    await writeFile(filePath, JSON.stringify(raw), 'utf-8');

    const result = await readPendingVscodeRestore('/Users/me/projects/stale');
    expect(result.status).toBe('expired');
  });

  it('sweeps an expired file during cleanup even when its version is unsupported', async () => {
    // A version-mismatched file fails readPendingVscodeRestore's own
    // schema parse (reported as 'unsupported-version' or 'corrupt'),
    // so the sweep must not rely on that same strict schema either, or
    // a version-skewed orphan would never expire.
    await writePendingVscodeRestore('/Users/me/projects/old-version', {
      terminals: [{ commands: ['echo hi'] }],
    });
    const dir = getVscodeRestoreDir();
    const files = await readdir(dir);
    const filePath = join(dir, files[0]!);
    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    raw.version = 999;
    raw.createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    await writeFile(filePath, JSON.stringify(raw), 'utf-8');

    // Triggers cleanupExpiredRestores as a side effect of staging an
    // unrelated new restore.
    await writePendingVscodeRestore('/Users/me/projects/unrelated', {
      terminals: [{ commands: ['echo hi'] }],
    });

    const stillThere = await access(filePath)
      .then(() => true)
      .catch(() => false);
    expect(stillThere).toBe(false);
  });

  it('deletes a pending restore, after which it reads back as "none"', async () => {
    await writePendingVscodeRestore('/Users/me/projects/to-delete', {
      terminals: [{ commands: ['echo hi'] }],
    });
    await deletePendingVscodeRestore('/Users/me/projects/to-delete');

    const result = await readPendingVscodeRestore('/Users/me/projects/to-delete');
    expect(result).toEqual({ status: 'none' });
  });

  it('does not throw when deleting a restore that was never staged', async () => {
    await expect(
      deletePendingVscodeRestore('/Users/me/projects/never-staged'),
    ).resolves.toBeUndefined();
  });
});

describe('writeCurrentWindowState / readCurrentWindowState / deleteCurrentWindowState', () => {
  beforeEach(() => {
    stubPlatform('darwin');
  });

  it('reports "none" when nothing was ever written for that folder', async () => {
    const result = await readCurrentWindowState('/Users/me/projects/never-opened');
    expect(result).toEqual({ status: 'none' });
  });

  it('reports "open" with a fresh heartbeat right after writing', async () => {
    await writeCurrentWindowState('/Users/me/projects/client-a', WINDOW_DETAILS);

    const result = await readCurrentWindowState('/Users/me/projects/client-a');

    expect(result.status).toBe('open');
    if (result.status === 'open') {
      expect(typeof result.updatedAt).toBe('string');
    }
  });

  it('matches the same folder regardless of a trailing slash, same as the pending-restore file', async () => {
    await writeCurrentWindowState('/Users/me/projects/client-a/', WINDOW_DETAILS);
    const result = await readCurrentWindowState('/Users/me/projects/client-a');
    expect(result.status).toBe('open');
  });

  it('reports "stale" once the heartbeat is older than 3x its own interval', async () => {
    await writeCurrentWindowState('/Users/me/projects/aging', WINDOW_DETAILS);
    const dir = getCurrentWindowStateDir();
    const files = await readdir(dir);
    const filePath = join(dir, files[0]!);
    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    raw.updatedAt = new Date(Date.now() - CURRENT_WINDOW_STATE_HEARTBEAT_MS * 4).toISOString();
    await writeFile(filePath, JSON.stringify(raw), 'utf-8');

    const result = await readCurrentWindowState('/Users/me/projects/aging');
    expect(result).toEqual({ status: 'stale' });
  });

  it('reports "none", never throws, for malformed JSON', async () => {
    await writeCurrentWindowState('/Users/me/projects/to-corrupt', WINDOW_DETAILS);
    const dir = getCurrentWindowStateDir();
    const files = await readdir(dir);
    await writeFile(join(dir, files[0]!), '{ not json', 'utf-8');

    const result = await readCurrentWindowState('/Users/me/projects/to-corrupt');
    expect(result).toEqual({ status: 'none' });
  });

  it('a later write refreshes the same file rather than creating a second one', async () => {
    await writeCurrentWindowState('/Users/me/projects/refreshed', WINDOW_DETAILS);
    await writeCurrentWindowState('/Users/me/projects/refreshed', WINDOW_DETAILS);

    const dir = getCurrentWindowStateDir();
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
  });

  it('deletes the heartbeat file, after which it reads back as "none"', async () => {
    await writeCurrentWindowState('/Users/me/projects/to-delete', WINDOW_DETAILS);
    await deleteCurrentWindowState('/Users/me/projects/to-delete');

    const result = await readCurrentWindowState('/Users/me/projects/to-delete');
    expect(result).toEqual({ status: 'none' });
  });

  it('does not throw when deleting a state that was never written', async () => {
    await expect(
      deleteCurrentWindowState('/Users/me/projects/never-written'),
    ).resolves.toBeUndefined();
  });

  it('is independent of the pending-restore file for the same folder — writing one never affects the other', async () => {
    await writePendingVscodeRestore('/Users/me/projects/both', {
      terminals: [{ commands: ['x'] }],
    });
    await writeCurrentWindowState('/Users/me/projects/both', WINDOW_DETAILS);

    const pending = await readPendingVscodeRestore('/Users/me/projects/both');
    const current = await readCurrentWindowState('/Users/me/projects/both');

    expect(pending.status).toBe('found');
    expect(current.status).toBe('open');
  });
});

describe('listOpenWindowFolders', () => {
  beforeEach(() => {
    stubPlatform('darwin');
  });

  it('returns an empty array when nothing has ever been written', async () => {
    expect(await listOpenWindowFolders()).toEqual([]);
  });

  it('returns every distinct open folder, one entry per window', async () => {
    await writeCurrentWindowState('/Users/me/projects/a', WINDOW_DETAILS);
    await writeCurrentWindowState('/Users/me/projects/b', WINDOW_DETAILS);

    const folders = await listOpenWindowFolders();

    expect(folders.sort()).toEqual(['/Users/me/projects/a', '/Users/me/projects/b']);
  });

  it('excludes a stale entry (older than 3x the heartbeat interval)', async () => {
    await writeCurrentWindowState('/Users/me/projects/fresh', WINDOW_DETAILS);
    await writeCurrentWindowState('/Users/me/projects/aged', WINDOW_DETAILS);

    const dir = getCurrentWindowStateDir();
    const files = (await readdir(dir)).sort();
    // Age whichever file corresponds to "aged" — both were just
    // written, so disambiguate by content rather than assuming order.
    for (const file of files) {
      const filePath = join(dir, file);
      const raw = JSON.parse(await readFile(filePath, 'utf-8'));
      if (raw.folderPath === '/Users/me/projects/aged') {
        raw.updatedAt = new Date(Date.now() - CURRENT_WINDOW_STATE_HEARTBEAT_MS * 4).toISOString();
        await writeFile(filePath, JSON.stringify(raw), 'utf-8');
      }
    }

    expect(await listOpenWindowFolders()).toEqual(['/Users/me/projects/fresh']);
  });

  it('skips a corrupt file rather than throwing', async () => {
    await writeCurrentWindowState('/Users/me/projects/good', WINDOW_DETAILS);
    const dir = getCurrentWindowStateDir();
    await writeFile(join(dir, 'state-garbage.json'), '{ not json', 'utf-8');

    expect(await listOpenWindowFolders()).toEqual(['/Users/me/projects/good']);
  });

  it('returns an empty array, not a throw, if the directory does not exist at all', async () => {
    // No writeCurrentWindowState call at all in this test — mkdir never ran.
    expect(await listOpenWindowFolders()).toEqual([]);
  });
});
