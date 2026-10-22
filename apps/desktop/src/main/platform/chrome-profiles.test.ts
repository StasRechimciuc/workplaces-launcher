import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { getLastUsedChromeProfileFolder, listChromeProfiles } from './chrome-profiles';

const originalPlatform = process.platform;
const originalLocalAppData = process.env['LOCALAPPDATA'];

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('listChromeProfiles', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    if (originalLocalAppData === undefined) {
      delete process.env['LOCALAPPDATA'];
    } else {
      process.env['LOCALAPPDATA'] = originalLocalAppData;
    }
  });

  it('reads from the macOS Local State path and maps/sorts profiles by display name', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Zed' },
            'Profile 1': { name: 'Alpha' },
          },
        },
      }),
    );

    const profiles = await listChromeProfiles();

    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('Library/Application Support/Google/Chrome/Local State'),
      'utf-8',
    );
    expect(profiles).toEqual([
      { folder: 'Profile 1', name: 'Alpha' },
      { folder: 'Default', name: 'Zed' },
    ]);
  });

  it('reads from the Windows Local State path when LOCALAPPDATA is set', async () => {
    setPlatform('win32');
    process.env['LOCALAPPDATA'] = 'C:\\Users\\Stas\\AppData\\Local';
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' } } } }),
    );

    await listChromeProfiles();

    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('Google\\Chrome\\User Data\\Local State'),
      'utf-8',
    );
  });

  it('fails loudly when LOCALAPPDATA is unset on Windows', async () => {
    setPlatform('win32');
    delete process.env['LOCALAPPDATA'];

    await expect(listChromeProfiles()).rejects.toThrow(/LOCALAPPDATA/);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails loudly on an unsupported platform', async () => {
    setPlatform('linux');

    await expect(listChromeProfiles()).rejects.toThrow(/isn't supported on this platform/);
  });

  it('reports a clear message when Chrome has never been installed/run (ENOENT)', async () => {
    setPlatform('darwin');
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValueOnce(enoent);

    await expect(listChromeProfiles()).rejects.toThrow(/doesn't appear to be installed/);
  });

  it('reports a clear message for any other read failure', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES: permission denied'));

    await expect(listChromeProfiles()).rejects.toThrow(/Could not read Chrome's profile data/);
  });

  it('reports a clear message when the file is malformed JSON', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce('{ not json');

    await expect(listChromeProfiles()).rejects.toThrow(/malformed/);
  });

  it('returns an empty array when info_cache is missing entirely', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ profile: {} }));

    expect(await listChromeProfiles()).toEqual([]);
  });

  it('falls back to the folder name when a profile entry has no name', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ profile: { info_cache: { 'Profile 3': {} } } }),
    );

    expect(await listChromeProfiles()).toEqual([{ folder: 'Profile 3', name: 'Profile 3' }]);
  });

  it('never returns gaia_name/user_name/avatar_icon — only folder and name', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        profile: {
          info_cache: {
            Default: {
              name: 'Stas',
              gaia_name: 'Stas Rechimciuc',
              user_name: 'stas@example.com',
              avatar_icon: 'chrome://theme/IDR_PROFILE_AVATAR_0',
            },
          },
        },
      }),
    );

    const profiles = await listChromeProfiles();

    expect(profiles).toEqual([{ folder: 'Default', name: 'Stas' }]);
    expect(Object.keys(profiles[0]!)).toEqual(['folder', 'name']);
  });
});

describe('getLastUsedChromeProfileFolder', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('returns the last_used profile folder', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ profile: { last_used: 'Profile 2' } }),
    );

    expect(await getLastUsedChromeProfileFolder()).toBe('Profile 2');
  });

  it('returns undefined, never throws, when the file is missing', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));

    expect(await getLastUsedChromeProfileFolder()).toBeUndefined();
  });

  it('returns undefined, never throws, for malformed JSON', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce('{ not json');

    expect(await getLastUsedChromeProfileFolder()).toBeUndefined();
  });

  it('returns undefined when last_used is missing or empty', async () => {
    setPlatform('darwin');
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ profile: {} }));
    expect(await getLastUsedChromeProfileFolder()).toBeUndefined();

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ profile: { last_used: '' } }));
    expect(await getLastUsedChromeProfileFolder()).toBeUndefined();
  });
});
