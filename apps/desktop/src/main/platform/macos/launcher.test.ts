import { beforeEach, describe, expect, it, vi } from 'vitest';
import { macosLauncher } from './launcher';
import * as shellExec from '../../lib/shell-exec';
import * as fsPromises from 'node:fs/promises';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);
const stat = vi.mocked(fsPromises.stat);
const writeFile = vi.mocked(fsPromises.writeFile);

beforeEach(() => {
  runCommand.mockClear();
  stat.mockReset();
  writeFile.mockReset();
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

  describe('openTerminal', () => {
    it('writes the exact, full script content in the correct line order — not just scattered substrings, which could pass even with the lines reordered or something extra leaked in between them', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openTerminal('/Users/stas/projects/x', ['npm i', 'npm run dev']);

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toBe(
        [
          '#!/bin/zsh -l',
          'rm -f -- "$0"',
          'clear',
          `cd '/Users/stas/projects/x' || { echo "cd into the configured directory failed."; exec "$SHELL" -l; }`,
          `echo '$ npm i'`,
          'npm i',
          `echo '$ npm run dev'`,
          'npm run dev',
          'exec "$SHELL" -l',
          '',
        ].join('\n'),
      );
    });

    it('writes the exact script content for a terminal with zero commands queued', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openTerminal('/Users/stas/projects/x', []);

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toBe(
        [
          '#!/bin/zsh -l',
          'rm -f -- "$0"',
          'clear',
          `cd '/Users/stas/projects/x' || { echo "cd into the configured directory failed."; exec "$SHELL" -l; }`,
          'exec "$SHELL" -l',
          '',
        ].join('\n'),
      );
    });

    it('writes a .command script and hands it to `open -a Terminal`', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      const result = await macosLauncher.openTerminal('/Users/stas/projects/x', ['npm run dev']);

      expect(stat).toHaveBeenCalledWith('/Users/stas/projects/x');
      expect(writeFile).toHaveBeenCalledTimes(1);
      const [scriptPath, contents] = writeFile.mock.calls[0]!;
      expect(String(scriptPath)).toMatch(/workspace-launcher-terminal-.*\.command$/);
      expect(contents).toContain("cd '/Users/stas/projects/x'");
      expect(contents).toContain('npm run dev');
      expect(contents).toContain('rm -f -- "$0"');
      expect(contents).toContain('exec "$SHELL" -l');

      expect(runCommand).toHaveBeenCalledWith('open', ['-a', 'Terminal', scriptPath]);
      expect(result).toEqual({ success: true, message: 'Opened a terminal at /Users/stas/projects/x.' });
    });

    it('never lets a hostile command be interpreted as anything other than a literal script line', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openTerminal('/tmp/x', ['echo "$(rm -rf ~)"']);

      // Written verbatim as plain file bytes — never shell-interpolated
      // or AppleScript-embedded by this process itself.
      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toContain('echo "$(rm -rf ~)"');
    });

    it('single-quote-escapes a cwd containing a literal single quote', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openTerminal("/tmp/it's-a-dir", []);

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toContain(`cd '/tmp/it'\\''s-a-dir'`);
    });

    it('echoes each command as its own single-quote-escaped label before running it, verbatim', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await macosLauncher.openTerminal('/tmp/x', [`echo "it's a test"`]);

      const [, contents] = writeFile.mock.calls[0]!;
      // The echo label is its own, separately-escaped single-quoted
      // string — the embedded apostrophe must not leak into (or be
      // affected by) the following line, which stays completely
      // verbatim since it's meant to run exactly as typed.
      expect(contents).toContain(`echo '$ echo "it'\\''s a test"'`);
      expect(contents).toContain(`echo "it's a test"`);
      // The echo line must come immediately before the command's own
      // execution line, in that order.
      const lines = String(contents).split('\n');
      const echoIndex = lines.indexOf(`echo '$ echo "it'\\''s a test"'`);
      expect(lines[echoIndex + 1]).toBe(`echo "it's a test"`);
    });

    it('fails loudly when cwd does not exist, without writing a script or opening anything', async () => {
      stat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await macosLauncher.openTerminal('/tmp/gone', []);

      expect(result).toEqual({ success: false, message: '"/tmp/gone" doesn\'t exist.' });
      expect(writeFile).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('fails loudly when cwd is a file, not a directory', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => false } as never);

      const result = await macosLauncher.openTerminal('/tmp/a-file.txt', []);

      expect(result).toEqual({ success: false, message: '"/tmp/a-file.txt" is not a directory.' });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('reports a script-write failure without throwing', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const result = await macosLauncher.openTerminal('/tmp/x', []);

      expect(result.success).toBe(false);
      expect(result.message).toContain('permission denied');
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('reports an `open` failure without throwing', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({
        success: false,
        message: 'no such app',
        stdout: '',
        stderr: '',
        code: 1,
      });

      const result = await macosLauncher.openTerminal('/tmp/x', []);

      expect(result.success).toBe(false);
      expect(result.message).toContain('/tmp/x');
      expect(result.message).toContain('no such app');
    });
  });
});
