import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowsLauncher } from './launcher';
import * as shellExec from '../../lib/shell-exec';
import * as appPaths from './app-paths';

vi.mock('../../lib/shell-exec', () => ({
  runDetached: vi.fn(),
}));

vi.mock('./app-paths', () => ({
  resolveAppPath: vi.fn(),
}));

const runDetached = vi.mocked(shellExec.runDetached);
const resolveAppPath = vi.mocked(appPaths.resolveAppPath);

beforeEach(() => {
  runDetached.mockClear();
  resolveAppPath.mockClear();
});

describe('windowsLauncher', () => {
  describe('launchApp', () => {
    it('resolves the app to its .exe and spawns it detached', async () => {
      resolveAppPath.mockReturnValue('C:\\Users\\dev\\AppData\\Roaming\\Spotify\\Spotify.exe');
      runDetached.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await windowsLauncher.launchApp('Spotify');

      expect(resolveAppPath).toHaveBeenCalledWith('Spotify');
      expect(runDetached).toHaveBeenCalledWith(
        'C:\\Users\\dev\\AppData\\Roaming\\Spotify\\Spotify.exe',
        [],
      );
      expect(result).toEqual({ success: true, message: 'Launched Spotify.' });
    });

    it('reports a failed resolveAppPath as a failed result, without throwing', async () => {
      resolveAppPath.mockImplementation(() => {
        throw new Error('Could not find NotAnApp installed on this machine.');
      });

      const result = await windowsLauncher.launchApp('NotAnApp');

      expect(runDetached).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: 'Could not find NotAnApp installed on this machine.',
      });
    });

    it('reports a runDetached failure without throwing', async () => {
      resolveAppPath.mockReturnValue('C:\\slack\\slack.exe');
      runDetached.mockResolvedValueOnce({
        success: false,
        message: 'ENOENT',
        stdout: '',
        stderr: '',
        code: null,
      });

      const result = await windowsLauncher.launchApp('Slack');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Slack');
      expect(result.message).toContain('ENOENT');
    });
  });

  describe('openInApp', () => {
    it('resolves VS Code and spawns it with the target path as argv', async () => {
      resolveAppPath.mockReturnValue('C:\\Program Files\\Microsoft VS Code\\Code.exe');
      runDetached.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await windowsLauncher.openInApp(
        'Visual Studio Code',
        'C:\\projects\\my-project',
      );

      expect(runDetached).toHaveBeenCalledWith('C:\\Program Files\\Microsoft VS Code\\Code.exe', [
        'C:\\projects\\my-project',
      ]);
      expect(result.success).toBe(true);
    });
  });

  describe('openUrlInBrowserProfile', () => {
    it('passes --profile-directory and the URL as separate argv entries', async () => {
      resolveAppPath.mockReturnValue('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
      runDetached.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await windowsLauncher.openUrlInBrowserProfile(
        'Google Chrome',
        'Profile 1',
        'https://example.com',
      );

      expect(runDetached).toHaveBeenCalledWith(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ['--profile-directory=Profile 1', 'https://example.com'],
      );
      expect(result.success).toBe(true);
    });

    it('never lets the profile or URL be interpreted as shell syntax', async () => {
      resolveAppPath.mockReturnValue('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
      runDetached.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await windowsLauncher.openUrlInBrowserProfile(
        'Google Chrome',
        '"; rm -rf ~ #',
        'https://example.com; rm -rf ~',
      );

      // Both hostile-looking values must arrive as single, literal argv
      // entries — never concatenated into a command string.
      const [, args] = runDetached.mock.calls[0]!;
      expect(args).toContain('--profile-directory="; rm -rf ~ #');
      expect(args).toContain('https://example.com; rm -rf ~');
    });

    it('passes --profile-directory only, with no trailing url, when url is omitted', async () => {
      resolveAppPath.mockReturnValue('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
      runDetached.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await windowsLauncher.openUrlInBrowserProfile('Google Chrome', 'Work');

      expect(runDetached).toHaveBeenCalledWith(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ['--profile-directory=Work'],
      );
      expect(result).toEqual({ success: true, message: 'Opened Google Chrome (profile: Work).' });
    });
  });
});
