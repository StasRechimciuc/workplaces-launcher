import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppIconDataUrl } from './app-icon';
import { runCommand } from '../lib/shell-exec';
import { readFile, unlink } from 'node:fs/promises';

vi.mock('../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

const mockedRunCommand = vi.mocked(runCommand);
const mockedReadFile = vi.mocked(readFile);
const mockedUnlink = vi.mocked(unlink);

function plutilSuccess(stdout: string): { success: true; stdout: string; stderr: string } {
  return { success: true, stdout, stderr: '' };
}

const shellFailure = { success: false as const, message: 'failed', stdout: '', stderr: '', code: 1 };

beforeEach(() => {
  mockedRunCommand.mockReset();
  mockedReadFile.mockReset();
  mockedUnlink.mockReset().mockResolvedValue(undefined);
});

describe('getAppIconDataUrl', () => {
  it('reads Info.plist, converts the icns via sips, and returns a data URL', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(plutilSuccess('AppIcon\n'))
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from('fake-png-bytes'));

    const result = await getAppIconDataUrl('/Applications/Figma.app');

    expect(result).toBe(`data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      1,
      'plutil',
      ['-extract', 'CFBundleIconFile', 'raw', '/Applications/Figma.app/Contents/Info.plist'],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      'sips',
      expect.arrayContaining([
        '/Applications/Figma.app/Contents/Resources/AppIcon.icns',
        '--out',
      ]),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('appends .icns only when CFBundleIconFile omits it', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(plutilSuccess('CustomIcon.icns\n'))
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from('x'));

    await getAppIconDataUrl('/Applications/Thing.app');

    const sipsArgs = mockedRunCommand.mock.calls[1]?.[1] as string[];
    expect(sipsArgs).toContain('/Applications/Thing.app/Contents/Resources/CustomIcon.icns');
  });

  it('returns null, not a throw, when Info.plist has no CFBundleIconFile key', async () => {
    mockedRunCommand.mockResolvedValueOnce(shellFailure);

    const result = await getAppIconDataUrl('/Applications/NoPlist.app');

    expect(result).toBeNull();
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('returns null when the extracted icon file name is blank', async () => {
    mockedRunCommand.mockResolvedValueOnce(plutilSuccess('   \n'));

    const result = await getAppIconDataUrl('/Applications/Blank.app');

    expect(result).toBeNull();
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('never lets a path-traversal CFBundleIconFile value escape the bundle\'s Resources folder', async () => {
    // appPath is user-chosen (the generic 'app' step type); a bundle
    // placed there by something untrusted could ship a crafted
    // Info.plist pointing sips at an arbitrary file elsewhere on disk.
    mockedRunCommand.mockResolvedValueOnce(plutilSuccess('../../../../etc/passwd\n'));

    const result = await getAppIconDataUrl('/Applications/Evil.app');

    expect(result).toBeNull();
    // Must never even attempt the sips conversion with the crafted path.
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('never lets a CFBundleIconFile value containing a path separator through', async () => {
    mockedRunCommand.mockResolvedValueOnce(plutilSuccess('sneaky/path\n'));

    const result = await getAppIconDataUrl('/Applications/Evil.app');

    expect(result).toBeNull();
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it('returns null, not a throw, when sips fails to convert the icon', async () => {
    mockedRunCommand.mockResolvedValueOnce(plutilSuccess('AppIcon\n')).mockResolvedValueOnce(shellFailure);

    const result = await getAppIconDataUrl('/Applications/BadIcon.app');

    expect(result).toBeNull();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('returns null, not a throw, when reading the converted PNG fails', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(plutilSuccess('AppIcon\n'))
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await getAppIconDataUrl('/Applications/Figma.app');

    expect(result).toBeNull();
  });

  it('always cleans up the temp PNG file, even on failure', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(plutilSuccess('AppIcon\n'))
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    await getAppIconDataUrl('/Applications/Figma.app');

    expect(mockedUnlink).toHaveBeenCalledTimes(1);
  });

  it('does not reject even when cleanup (unlink) itself fails', async () => {
    mockedRunCommand
      .mockResolvedValueOnce(plutilSuccess('AppIcon\n'))
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    mockedReadFile.mockResolvedValueOnce(Buffer.from('x'));
    mockedUnlink.mockReset().mockRejectedValueOnce(new Error('ENOENT'));

    const result = await getAppIconDataUrl('/Applications/Figma.app');

    expect(result).toBe(`data:image/png;base64,${Buffer.from('x').toString('base64')}`);
  });
});
