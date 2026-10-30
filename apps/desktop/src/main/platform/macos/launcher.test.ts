import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';
import { macosLauncher } from './launcher';
import type { PlatformResult } from '../types';
import * as shellExec from '../../lib/shell-exec';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The real openTerminal takes a 3rd, non-interface parameter (a test-
// only seam — see launcher.ts's own comment on it) that the exported
// macosLauncher binding's PlatformLauncher-typed signature hides from
// callers. This cast reaches past that, deliberately, only in tests
// that need the real exit-code poll to run fast.
const openTerminalWithPollOptions = macosLauncher.openTerminal as (
  cwd: string,
  commands: string[],
  options?: { marker?: string; intervalMs?: number; timeoutMs?: number; startTimeoutMs?: number },
) => Promise<PlatformResult>;

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

/** A real `readFile` ENOENT rejection carries `.code`, not just a
 * message that happens to say "ENOENT" — waitForEarlyCommandFailure's
 * error handling keys off `.code` specifically (see its own comment
 * on why a non-ENOENT I/O error must NOT be swallowed the same way),
 * so a mock without it would test a shape readFile never actually
 * produces. */
function enoentError(): NodeJS.ErrnoException {
  const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

// Fixed so openTerminal's generated script content (which now embeds a
// uuid'd sentinel path) is deterministic and assertable with `.toBe()`
// instead of only loose substring checks.
vi.mock('node:crypto', () => ({
  randomUUID: () => 'fixed-uuid',
}));

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
}));

const runCommand = vi.mocked(shellExec.runCommand);
const stat = vi.mocked(fsPromises.stat);
const writeFile = vi.mocked(fsPromises.writeFile);
const readFile = vi.mocked(fsPromises.readFile);
const unlink = vi.mocked(fsPromises.unlink);
const openPath = vi.mocked(shell.openPath);
const openExternal = vi.mocked(shell.openExternal);

beforeEach(() => {
  runCommand.mockClear();
  stat.mockReset();
  writeFile.mockReset();
  readFile.mockReset();
  unlink.mockReset();
  unlink.mockResolvedValue(undefined);
  openPath.mockReset();
  openExternal.mockReset();
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
    // randomUUID is mocked to 'fixed-uuid' at the top of this file, so
    // the sentinel path openTerminal embeds into the script is
    // deterministic — computed here via the REAL (unmocked) tmpdir/join
    // so it matches exactly what the implementation itself computes.
    const sentinelPath = join(tmpdir(), 'workspace-launcher-terminal-fixed-uuid.status');
    const outputLogPath = join(tmpdir(), 'workspace-launcher-terminal-fixed-uuid.out');
    // Fast, test-only poll window — passed as openTerminal's 3rd (non-
    // interface) parameter so tests never wait out the real ~2.5s
    // window.
    const fastPoll = { intervalMs: 1, timeoutMs: 10, startTimeoutMs: 10 };

    it('writes the exact, full script content in the correct line order — not just scattered substrings, which could pass even with the lines reordered or something extra leaked in between them', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions(
        '/Users/stas/projects/x',
        ['npm i', 'npm run dev'],
        fastPoll,
      );

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toBe(
        [
          '#!/bin/zsh -l',
          'rm -f -- "$0"',
          `echo "started" >> '${sentinelPath}'`,
          'clear',
          `cd '/Users/stas/projects/x' || { echo "cd into the configured directory failed."; echo "cd:1" >> '${sentinelPath}'; exec "$SHELL" -l; }`,
          `echo '$ npm i'`,
          `echo "###OUT:0###" >> '${outputLogPath}'`,
          `{ npm i; echo "0:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
          `echo '$ npm run dev'`,
          `echo "###OUT:1###" >> '${outputLogPath}'`,
          `{ npm run dev; echo "1:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
          'exec "$SHELL" -l',
          '',
        ].join('\n'),
      );
    });

    it('finishes as soon as every command has succeeded, without waiting out the failure window', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockResolvedValue('started\n0:0\n1:0\n' as never);

      const startedAt = Date.now();
      const result = await openTerminalWithPollOptions('/Users/stas/x', ['echo a', 'echo b'], {
        intervalMs: 1,
        timeoutMs: 5_000,
        startTimeoutMs: 1_000,
      });

      expect(result.success).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    });

    it('writes the exact tracked-terminal script: marker title, session files, re-run loop', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      const marker = 'wl-0123456789ab';
      await openTerminalWithPollOptions('/Users/stas/projects/x', ['npm run dev'], {
        ...fastPoll,
        marker,
      });

      const session = join(tmpdir(), `workspace-launcher-session-${marker}`);
      // A previous window's leftover session files are gone before this one starts.
      const unlinked = vi.mocked(fsPromises.unlink).mock;
      expect(unlinked.calls.map(([path]) => path)).toEqual(
        expect.arrayContaining([`${session}.info`, `${session}.state`, `${session}.rerun`]),
      );
      expect(Math.max(...unlinked.invocationCallOrder.slice(0, 3))).toBeLessThan(
        writeFile.mock.invocationCallOrder[0]!,
      );
      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toBe(
        [
          '#!/bin/zsh -l',
          'rm -f -- "$0"',
          `echo "started" >> '${sentinelPath}'`,
          `printf '\\e]0;%s\\a' '${marker}'`,
          `print -r -- "$TTY $$" > '${session}.info'`,
          `echo running > '${session}.state'`,
          "trap 'wl_interrupted=1' INT",
          'clear',
          `cd '/Users/stas/projects/x' || { echo "cd into the configured directory failed."; echo "cd:1" >> '${sentinelPath}'; printf '\\e]0;\\a'; exec "$SHELL" -l; }`,
          'wl_run() {',
          '  wl_interrupted=0',
          `  echo '$ npm run dev'`,
          `  echo "###OUT:0###" >> '${outputLogPath}'`,
          `  { npm run dev; echo "0:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
          '  (( wl_interrupted )) && return',
          '}',
          'wl_run',
          'while true; do',
          `  echo done > '${session}.state'`,
          "  echo ''",
          "  echo '[Workspace Launcher] Commands finished — press any key for a shell.'",
          `  while [[ ! -f '${session}.rerun' ]]; do`,
          '    if read -s -t 1 -k 1; then',
          `      echo shell > '${session}.state'`,
          '      trap - INT',
          `      printf '\\e]0;\\a'; exec "$SHELL" -l`,
          '    fi',
          '  done',
          `  rm -f -- '${session}.rerun'`,
          `  echo running > '${session}.state'`,
          '  wl_run',
          'done',
          '',
        ].join('\n'),
      );

      // And it's valid zsh — checked by the real zsh, not by eye.
      if (process.platform === 'darwin') {
        const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
        const { execFileSync } =
          await vi.importActual<typeof import('node:child_process')>('node:child_process');
        const dir = await realFs.mkdtemp(join(tmpdir(), 'wl-script-test-'));
        const file = join(dir, 'check.zsh');
        await realFs.writeFile(file, String(contents));
        try {
          expect(() => execFileSync('/bin/zsh', ['-n', file])).not.toThrow();
        } finally {
          await realFs.rm(dir, { recursive: true, force: true });
        }
      }
    });

    it('writes the exact script content for a terminal with zero commands queued', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions('/Users/stas/projects/x', [], fastPoll);

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toBe(
        [
          '#!/bin/zsh -l',
          'rm -f -- "$0"',
          `echo "started" >> '${sentinelPath}'`,
          'clear',
          `cd '/Users/stas/projects/x' || { echo "cd into the configured directory failed."; echo "cd:1" >> '${sentinelPath}'; exec "$SHELL" -l; }`,
          'exec "$SHELL" -l',
          '',
        ].join('\n'),
      );
    });

    it('still catches a cd failure for a terminal with zero commands — the only thing that CAN fail for one', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      // Not *Once* — phase 1 (did the script even start?) and phase 2
      // (did anything fail?) each read the sentinel at least once now,
      // and both need to see this same content.
      readFile.mockResolvedValue('cd:1\n');

      const result = await openTerminalWithPollOptions('/Users/stas/projects/x', [], fastPoll);

      expect(result.success).toBe(false);
      expect(result.message).toContain('changing into "/Users/stas/projects/x"');
      expect(unlink).toHaveBeenCalledWith(sentinelPath);
    });

    it('writes a .command script and hands it to `open -a Terminal`', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      const result = await openTerminalWithPollOptions(
        '/Users/stas/projects/x',
        ['npm run dev'],
        fastPoll,
      );

      expect(stat).toHaveBeenCalledWith('/Users/stas/projects/x');
      expect(writeFile).toHaveBeenCalledTimes(1);
      const [scriptPath, contents] = writeFile.mock.calls[0]!;
      expect(String(scriptPath)).toMatch(/workspace-launcher-terminal-.*\.command$/);
      expect(contents).toContain("cd '/Users/stas/projects/x'");
      expect(contents).toContain('npm run dev');
      expect(contents).toContain('rm -f -- "$0"');
      expect(contents).toContain('exec "$SHELL" -l');

      expect(runCommand).toHaveBeenCalledWith('open', ['-a', 'Terminal', scriptPath]);
      expect(result).toEqual({
        success: true,
        message: 'Opened a terminal at /Users/stas/projects/x.',
      });
      // The sentinel is cleaned up once a result has been decided,
      // regardless of outcome.
      expect(unlink).toHaveBeenCalledWith(sentinelPath);
    });

    it('never lets a hostile command be interpreted as anything other than a literal script line', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions('/tmp/x', ['echo "$(rm -rf ~)"'], fastPoll);

      // Written verbatim as plain file bytes — never shell-interpolated
      // or AppleScript-embedded by this process itself.
      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toContain('echo "$(rm -rf ~)"');
    });

    it("wraps a command containing its own pipe in a { ...; } group, so $? still captures the user's command — never $pipestatus misreading the outer tee wrapping", async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions(
        '/Users/stas/projects/x',
        ['npm run build | tee build.log'],
        fastPoll,
      );

      const [, contents] = writeFile.mock.calls[0]!;
      // The user's own pipe stays completely verbatim INSIDE the group
      // — our own tee wrapping and $? capture sit outside it, so the
      // user's command's own exit code (not some outer pipeline stage)
      // is what ends up in the sentinel, regardless of what the user's
      // command itself contains.
      expect(contents).toContain(
        `{ npm run build | tee build.log; echo "0:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
      );
      expect(contents).not.toContain('pipestatus');
    });

    it('single-quote-escapes a cwd containing a literal single quote', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions("/tmp/it's-a-dir", [], fastPoll);

      const [, contents] = writeFile.mock.calls[0]!;
      expect(contents).toContain(`cd '/tmp/it'\\''s-a-dir'`);
    });

    it('echoes each command as its own single-quote-escaped label before running it, verbatim', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockResolvedValueOnce(undefined);
      runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      readFile.mockRejectedValue(enoentError());

      await openTerminalWithPollOptions('/tmp/x', [`echo "it's a test"`], fastPoll);

      const [, contents] = writeFile.mock.calls[0]!;
      // The echo label is its own, separately-escaped single-quoted
      // string — the embedded apostrophe must not leak into (or be
      // affected by) the following line, which stays completely
      // verbatim since it's meant to run exactly as typed.
      expect(contents).toContain(`echo '$ echo "it'\\''s a test"'`);
      expect(contents).toContain(
        `{ echo "it's a test"; echo "0:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
      );
      // The echo label must come immediately before the output-log
      // marker, which comes immediately before the command's own
      // (grouped, piped) execution line, in that order.
      const lines = String(contents).split('\n');
      const echoIndex = lines.indexOf(`echo '$ echo "it'\\''s a test"'`);
      expect(lines[echoIndex + 1]).toBe(`echo "###OUT:0###" >> '${outputLogPath}'`);
      expect(lines[echoIndex + 2]).toBe(
        `{ echo "it's a test"; echo "0:$?" >> '${sentinelPath}'; } 2>&1 | tee -a '${outputLogPath}'`,
      );
    });

    it('fails loudly when cwd does not exist, without writing a script or opening anything', async () => {
      stat.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await openTerminalWithPollOptions('/tmp/gone', []);

      expect(result).toEqual({
        success: false,
        message: '"/tmp/gone" doesn\'t exist.',
        detail: {
          cwd: '/tmp/gone',
          openFailed: { stage: 'cd', reason: '"/tmp/gone" doesn\'t exist.' },
          commands: [],
        },
      });
      expect(writeFile).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    });

    it('fails loudly when cwd is a file, not a directory', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => false } as never);

      const result = await openTerminalWithPollOptions('/tmp/a-file.txt', []);

      expect(result).toEqual({
        success: false,
        message: '"/tmp/a-file.txt" is not a directory.',
        detail: {
          cwd: '/tmp/a-file.txt',
          openFailed: { stage: 'cd', reason: '"/tmp/a-file.txt" is not a directory.' },
          commands: [],
        },
      });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('reports a script-write failure without throwing', async () => {
      stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
      writeFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const result = await openTerminalWithPollOptions('/tmp/x', []);

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

      const result = await openTerminalWithPollOptions('/tmp/x', []);

      expect(result.success).toBe(false);
      expect(result.message).toContain('/tmp/x');
      expect(result.message).toContain('no such app');
    });

    describe('early command-failure detection', () => {
      it("(regression) still catches a near-instant real failure even when the sentinel takes a while to appear at all — the actual bug: Terminal.app's own launch/window-open overhead (measured ~2.1s even warm) used to eat directly into the command-failure budget, so a real `docker compose up` failure (no compose file present, fails in ~0.1s once it actually runs) could be missed simply because the terminal itself was slow to open, not because the command was slow to fail", async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        // Simulates Terminal.app taking a few poll ticks to even open the
        // window and start running the script (ENOENT — nothing written
        // yet) — by the time it finally does, the command has ALREADY
        // failed, exactly as it does in reality (the command itself
        // fails in well under a second once it actually starts).
        let calls = 0;
        readFile.mockImplementation((path) => {
          calls++;
          if (calls <= 3) return Promise.reject(enoentError());
          if (path === sentinelPath) return Promise.resolve('started\n0:1\n');
          return Promise.reject(enoentError());
        });

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['docker compose up -d --wait-timeout 120'],
          fastPoll,
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('exit code 1');
      });

      it('reports a real failure when a command exits nonzero within the poll window, with structured detail including captured output', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        readFile.mockImplementation((path) => {
          if (path === sentinelPath) return Promise.resolve('0:1\n');
          if (path === outputLogPath) {
            return Promise.resolve('###OUT:0###\nno configuration file provided\n');
          }
          return Promise.reject(new Error('ENOENT'));
        });

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['docker compose up'],
          fastPoll,
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('"docker compose up"');
        expect(result.message).toContain('exit code 1');
        expect(result.detail).toEqual({
          cwd: '/Users/stas/projects/x',
          commands: [
            {
              index: 0,
              command: 'docker compose up',
              status: 'failed',
              exitCode: 1,
              reason: 'no configuration file provided',
            },
          ],
        });
        expect(unlink).toHaveBeenCalledWith(outputLogPath);
      });

      it('identifies which command failed by index in a multi-command terminal, marking the earlier one success and the later one not-run', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        readFile.mockImplementation((path) => {
          if (path === sentinelPath) return Promise.resolve('0:0\n1:127\n');
          if (path === outputLogPath) {
            return Promise.resolve('###OUT:0###\nok\n###OUT:1###\nzsh: command not found: npm\n');
          }
          return Promise.reject(new Error('ENOENT'));
        });

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['nvm use', 'npm run dev', 'npm run build'],
          fastPoll,
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('"npm run dev"');
        expect(result.message).toContain('exit code 127');
        expect(result.detail).toEqual({
          cwd: '/Users/stas/projects/x',
          commands: [
            { index: 0, command: 'nvm use', status: 'success' },
            {
              index: 1,
              command: 'npm run dev',
              status: 'failed',
              exitCode: 127,
              reason: 'zsh: command not found: npm',
            },
            { index: 2, command: 'npm run build', status: 'not-run' },
          ],
        });
      });

      it('reports a real failure when cd into the configured directory fails inside the script', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        // Not *Once* — see the zero-commands cd-failure test's own
        // comment above for why both poll phases need the same value.
        readFile.mockResolvedValue('cd:1\n');

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['npm run dev'],
          fastPoll,
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('changing into "/Users/stas/projects/x"');
      });

      it('treats a command still running at the end of the window as success, not a failure', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        // A real long-running dev server never writes its own sentinel
        // line — simulated here as the sentinel never existing.
        readFile.mockRejectedValue(enoentError());

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['npm run dev'],
          fastPoll,
        );

        expect(result).toEqual({
          success: true,
          message: 'Opened a terminal at /Users/stas/projects/x.',
        });
      });

      it('(regression) propagates a real I/O error from the sentinel read, instead of treating it as "not written yet"', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        const eacces = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        eacces.code = 'EACCES';
        readFile.mockRejectedValue(eacces);

        await expect(
          openTerminalWithPollOptions('/Users/stas/projects/x', ['npm run dev'], fastPoll),
        ).rejects.toThrow('EACCES');
      });

      it('treats an exit code of 0 as success, not as "still running"', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        // Persistent: a 0-exit entry alone never stops the poll early
        // (there could still be a later command to watch for), so this
        // content is read more than once before the window elapses.
        readFile.mockResolvedValue('0:0\n');

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['echo hi'],
          fastPoll,
        );

        expect(result.success).toBe(true);
      });

      it('ignores a trailing partial line still being written when it reads mid-write', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        // No trailing newline — "1:1" hasn't finished being written yet.
        // Persistent (not Once): the content never changes across
        // repeated polls in this test, so the window simply elapses.
        readFile.mockResolvedValue('0:0\n1:1');

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['echo hi', 'docker compose up'],
          fastPoll,
        );

        // The incomplete line must be ignored this round — nothing
        // failed among the complete lines, so this poll tick alone
        // isn't a failure (a later tick would see it once complete).
        expect(result.success).toBe(true);
      });

      it('falls back to a generic reason when a failed command captured no output', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        readFile.mockImplementation((path) => {
          if (path === sentinelPath) return Promise.resolve('0:1\n');
          return Promise.reject(new Error('ENOENT')); // no output log at all
        });

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['false'],
          fastPoll,
        );

        expect(result.detail).toEqual({
          cwd: '/Users/stas/projects/x',
          commands: [
            {
              index: 0,
              command: 'false',
              status: 'failed',
              exitCode: 1,
              reason: 'Exited with code 1 (no output captured).',
            },
          ],
        });
      });

      it('caps a captured reason to the last COMMAND_OUTPUT_TAIL_MAX_CHARS characters, keeping the real terminal window as the source of the full output', async () => {
        stat.mockResolvedValueOnce({ isDirectory: () => true } as never);
        writeFile.mockResolvedValueOnce(undefined);
        runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
        const longOutput = 'x'.repeat(3000);
        readFile.mockImplementation((path) => {
          if (path === sentinelPath) return Promise.resolve('0:1\n');
          if (path === outputLogPath) return Promise.resolve(`###OUT:0###\n${longOutput}\n`);
          return Promise.reject(new Error('ENOENT'));
        });

        const result = await openTerminalWithPollOptions(
          '/Users/stas/projects/x',
          ['verbose-command'],
          fastPoll,
        );

        const detail = result.detail as { commands: { reason?: string }[] };
        const reason = detail.commands[0]!.reason!;
        expect(reason.startsWith('…')).toBe(true);
        expect(reason.length).toBe(2001); // the ellipsis plus the 2000-char cap
        expect(reason.endsWith('x')).toBe(true);
      });
    });
  });

  describe('openFileDefault', () => {
    it('reports success when shell.openPath resolves empty', async () => {
      openPath.mockResolvedValueOnce('');

      const result = await macosLauncher.openFileDefault('/tmp/plan.pdf');

      expect(openPath).toHaveBeenCalledWith('/tmp/plan.pdf');
      expect(result).toEqual({ success: true, message: 'Opened /tmp/plan.pdf.' });
    });

    it('treats a non-empty resolved string as a failure, not a throw — shell.openPath never throws for a normal "can\'t open" failure', async () => {
      openPath.mockResolvedValueOnce('No application knows how to open this file.');

      const result = await macosLauncher.openFileDefault('/tmp/weird.xyz');

      expect(result.success).toBe(false);
      expect(result.message).toContain('/tmp/weird.xyz');
      expect(result.message).toContain('No application knows how to open this file.');
    });

    it('reports a thrown rejection without throwing', async () => {
      openPath.mockRejectedValueOnce(new Error('unexpected'));

      const result = await macosLauncher.openFileDefault('/tmp/plan.pdf');

      expect(result.success).toBe(false);
      expect(result.message).toContain('unexpected');
    });
  });

  describe('openUrlDefault', () => {
    it('shells out via shell.openExternal and reports success', async () => {
      openExternal.mockResolvedValueOnce(undefined);

      const result = await macosLauncher.openUrlDefault('https://example.com');

      expect(openExternal).toHaveBeenCalledWith('https://example.com');
      expect(result).toEqual({ success: true, message: 'Opened https://example.com.' });
    });

    it('reports a rejection without throwing', async () => {
      openExternal.mockRejectedValueOnce(new Error('blocked'));

      const result = await macosLauncher.openUrlDefault('https://example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('blocked');
    });
  });
});
