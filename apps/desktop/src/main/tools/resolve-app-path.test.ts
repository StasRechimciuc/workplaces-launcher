import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { resolveAppLaunchTarget } from './resolve-app-path';
import { getCandidatesForTool } from '../platform/app-detection-cache';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('../platform/app-detection-cache', () => ({
  getCandidatesForTool: vi.fn(),
}));

const mockedAccess = vi.mocked(access);
const mockedGetCandidatesForTool = vi.mocked(getCandidatesForTool);

beforeEach(() => {
  mockedAccess.mockReset();
  mockedGetCandidatesForTool.mockReset();
});

describe('resolveAppLaunchTarget', () => {
  it('returns the configured appPath verbatim when it still exists, without consulting the cache', async () => {
    mockedAccess.mockResolvedValueOnce(undefined);

    const result = await resolveAppLaunchTarget(
      'vscode',
      'Visual Studio Code',
      '/Applications/Visual Studio Code.app',
    );

    expect(result).toEqual({ ok: true, target: '/Applications/Visual Studio Code.app' });
    expect(mockedGetCandidatesForTool).not.toHaveBeenCalled();
  });

  it('fails loudly with a specific message when the configured appPath no longer exists', async () => {
    mockedAccess.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await resolveAppLaunchTarget('chrome', 'Google Chrome', '/old/Google Chrome.app');

    expect(result).toEqual({
      ok: false,
      message:
        'Google Chrome not found at /old/Google Chrome.app — it may have moved or been uninstalled.',
    });
    expect(mockedGetCandidatesForTool).not.toHaveBeenCalled();
  });

  it('falls back to the cache\'s first candidate when no appPath is configured', async () => {
    mockedGetCandidatesForTool.mockResolvedValueOnce([
      { path: '/Applications/Spotify.app', displayName: 'Spotify' },
      { path: '/Users/me/Applications/Spotify.app', displayName: 'Spotify' },
    ]);

    const result = await resolveAppLaunchTarget('spotify', 'Spotify', undefined);

    expect(result).toEqual({ ok: true, target: '/Applications/Spotify.app' });
    expect(mockedAccess).not.toHaveBeenCalled();
  });

  it('falls back to the plain hardcoded name when no appPath is configured and the cache has zero candidates', async () => {
    mockedGetCandidatesForTool.mockResolvedValueOnce([]);

    const result = await resolveAppLaunchTarget('clockify', 'Clockify Desktop', undefined);

    expect(result).toEqual({ ok: true, target: 'Clockify Desktop' });
  });

  it('treats an empty-string appPath the same as absent (falls back to the cache)', async () => {
    mockedGetCandidatesForTool.mockResolvedValueOnce([]);

    const result = await resolveAppLaunchTarget('vscode', 'Visual Studio Code', '');

    expect(result).toEqual({ ok: true, target: 'Visual Studio Code' });
    expect(mockedAccess).not.toHaveBeenCalled();
  });
});
