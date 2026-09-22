import { beforeEach, describe, expect, it, vi } from 'vitest';
import { macosLauncher } from './launcher';
import * as shellExec from '../../lib/shell-exec';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);

beforeEach(() => {
  runCommand.mockClear();
});

describe('macosLauncher', () => {
  describe('launchApp', () => {
    it('shells out to `open -a <app>` and reports success', async () => {
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await macosLauncher.launchApp('Spotify');

      expect(runCommand).toHaveBeenCalledWith('open', ['-a', 'Spotify']);
      expect(result).toEqual({ success: true, message: 'Launched Spotify.' });
    });

    it('reports failure without throwing', async () => {
      runCommand.mockResolvedValueOnce({
        success: false,
        message: 'no such app',
        stdout: '',
        stderr: '',
        code: 1,
      });

      const result = await macosLauncher.launchApp('NotAnApp');

      expect(result.success).toBe(false);
      expect(result.message).toContain('NotAnApp');
      expect(result.message).toContain('no such app');
    });
  });

  describe('openInApp', () => {
    it('shells out to `open -a <app> <path>`', async () => {
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await macosLauncher.openInApp('Visual Studio Code', '/tmp/my-project');

      expect(runCommand).toHaveBeenCalledWith('open', [
        '-a',
        'Visual Studio Code',
        '/tmp/my-project',
      ]);
      expect(result.success).toBe(true);
    });
  });

  describe('openUrlInBrowserProfile', () => {
    it('passes --profile-directory and the URL through --args', async () => {
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await macosLauncher.openUrlInBrowserProfile(
        'Google Chrome',
        'Profile 1',
        'https://example.com',
      );

      expect(runCommand).toHaveBeenCalledWith('open', [
        '-n',
        '-a',
        'Google Chrome',
        '--args',
        '--profile-directory=Profile 1',
        'https://example.com',
      ]);
      expect(result.success).toBe(true);
    });

    it('never lets the profile or URL be interpreted as shell syntax', async () => {
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openUrlInBrowserProfile(
        'Google Chrome',
        '"; rm -rf ~ #',
        'https://example.com; rm -rf ~',
      );

      // Both hostile-looking values must arrive as single, literal argv
      // entries — never concatenated into a command string.
      const [, args] = runCommand.mock.calls[0]!;
      expect(args).toContain('--profile-directory="; rm -rf ~ #');
      expect(args).toContain('https://example.com; rm -rf ~');
    });

    it('passes --profile-directory only, with no trailing url, when url is omitted', async () => {
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await macosLauncher.openUrlInBrowserProfile('Google Chrome', 'Work');

      expect(runCommand).toHaveBeenCalledWith('open', [
        '-n',
        '-a',
        'Google Chrome',
        '--args',
        '--profile-directory=Work',
      ]);
      expect(result).toEqual({ success: true, message: 'Opened Google Chrome (profile: Work).' });
    });

    it('always forces a new process via -n, since an already-running Chrome silently ignores --args', async () => {
      // Regression test for a real bug found via manual testing:
      // `open -a` alone only delivers --args at the moment it spawns a
      // NEW process. With Chrome already running (the common case),
      // both --profile-directory and the URL were silently dropped —
      // no error, no tab opened, nothing. `-n` forces a fresh process
      // every time, which is required for this to work at all whether
      // or not Chrome happens to already be open.
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openUrlInBrowserProfile(
        'Google Chrome',
        'Default',
        'https://example.com',
      );

      const [, args] = runCommand.mock.calls[0]!;
      expect(args).toContain('-n');
      expect(args!.indexOf('-n')).toBeLessThan(args!.indexOf('-a'));
    });

    it('reports a profile-only-launch failure without throwing', async () => {
      runCommand.mockResolvedValueOnce({
        success: false,
        message: 'no such app',
        stdout: '',
        stderr: '',
        code: 1,
      });

      const result = await macosLauncher.openUrlInBrowserProfile('Google Chrome', 'Work');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Google Chrome');
      expect(result.message).toContain('no such app');
    });
  });
});
