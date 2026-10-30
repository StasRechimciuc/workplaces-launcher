import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanInstalledApps } from './app-detection';
import { runCommand } from '../lib/shell-exec';

vi.mock('../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const mockedRunCommand = vi.mocked(runCommand);

function mdfindSuccess(stdout: string): { success: true; stdout: string; stderr: string } {
  return { success: true, stdout, stderr: '' };
}

const shellFailure = {
  success: false as const,
  message: 'failed',
  stdout: '',
  stderr: '',
  code: 1,
};

beforeEach(() => {
  mockedRunCommand.mockReset();
});

describe('scanInstalledApps', () => {
  it('queries mdfind once per known tool and parses matching paths into candidates', async () => {
    mockedRunCommand.mockImplementation(async (_cmd, args) => {
      const query = String(args?.[0]);
      if (query.includes('Visual Studio Code')) {
        return mdfindSuccess('/Applications/Visual Studio Code.app\n');
      }
      return mdfindSuccess('');
    });

    const result = await scanInstalledApps();

    expect(result.vscode).toEqual([
      { path: '/Applications/Visual Studio Code.app', displayName: 'Visual Studio Code' },
    ]);
    expect(result.chrome).toEqual([]);
    expect(mockedRunCommand).toHaveBeenCalledTimes(4); // once per TOOL_APP_KEYS entry
  });

  it('finds an app outside the standard install folders — regression test for the real gap this exists to fix (an app left in ~/Downloads, never dragged into /Applications)', async () => {
    mockedRunCommand.mockImplementation(async (_cmd, args) => {
      const query = String(args?.[0]);
      if (query.includes('Clockify')) {
        return mdfindSuccess('/Users/stas/Downloads/Clockify Desktop.app\n');
      }
      return mdfindSuccess('');
    });

    const result = await scanInstalledApps();

    expect(result.clockify).toEqual([
      { path: '/Users/stas/Downloads/Clockify Desktop.app', displayName: 'Clockify Desktop' },
    ]);
  });

  it('returns every match, not a single silently-picked winner — e.g. a second copy left in Downloads', async () => {
    mockedRunCommand.mockImplementation(async (_cmd, args) => {
      const query = String(args?.[0]);
      if (query.includes('Spotify')) {
        return mdfindSuccess('/Users/stas/Downloads/Spotify.app\n/Applications/Spotify.app\n');
      }
      return mdfindSuccess('');
    });

    const result = await scanInstalledApps();

    expect(result.spotify).toEqual([
      { path: '/Users/stas/Downloads/Spotify.app', displayName: 'Spotify' },
      { path: '/Applications/Spotify.app', displayName: 'Spotify' },
    ]);
  });

  it('never offers an installer ("Install Spotify.app") as a copy of the app', async () => {
    mockedRunCommand.mockResolvedValue(mdfindSuccess(''));

    await scanInstalledApps();

    for (const call of mockedRunCommand.mock.calls) {
      expect(String(call[1]?.[0])).toContain("kMDItemCFBundleIdentifier != '*installer*'c");
    }
  });

  it('treats a failed mdfind call as zero candidates, not an error', async () => {
    mockedRunCommand.mockResolvedValue(shellFailure);

    await expect(scanInstalledApps()).resolves.toEqual({
      vscode: [],
      chrome: [],
      spotify: [],
      clockify: [],
    });
  });

  it('ignores blank lines in mdfind output', async () => {
    mockedRunCommand.mockImplementation(async (_cmd, args) => {
      const query = String(args?.[0]);
      if (query.includes('Chrome')) {
        return mdfindSuccess('/Applications/Google Chrome.app\n\n\n');
      }
      return mdfindSuccess('');
    });

    const result = await scanInstalledApps();

    expect(result.chrome).toEqual([
      { path: '/Applications/Google Chrome.app', displayName: 'Google Chrome' },
    ]);
  });

  it('passes the query as a single argv element, never shell-interpolated', async () => {
    mockedRunCommand.mockResolvedValue(mdfindSuccess(''));

    await scanInstalledApps();

    for (const call of mockedRunCommand.mock.calls) {
      expect(call[0]).toBe('mdfind');
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[1]).toHaveLength(1);
    }
  });
});
