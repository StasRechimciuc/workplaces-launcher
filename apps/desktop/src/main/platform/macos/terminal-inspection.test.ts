import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectTerminalAppWindows } from './terminal-inspection';
import * as shellExec from '../../lib/shell-exec';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);

beforeEach(() => {
  runCommand.mockClear();
});

describe('inspectTerminalAppWindows("Terminal")', () => {
  it('reports cwd + command for a window actively running a non-shell foreground job', async () => {
    runCommand
      // tty of every window
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      // ps -t ttys004
      .mockResolvedValueOnce({
        success: true,
        stdout: ['12345 S+   -zsh', '12399 R+   npm run dev'].join('\n'),
        stderr: '',
      })
      // lsof -p 12399 -F n
      .mockResolvedValueOnce({
        success: true,
        stdout: 'p12399\nfcwd\nn/Users/stas/Work/Client Project\n',
        stderr: '',
      });

    const windows = await inspectTerminalAppWindows('Terminal');

    expect(windows).toEqual([{ cwd: '/Users/stas/Work/Client Project', command: 'npm run dev' }]);
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      'ps',
      ['-t', 'ttys004', '-o', 'pid=,stat=,command='],
      { timeoutMs: 5000 },
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      3,
      'lsof',
      ['-a', '-d', 'cwd', '-p', '12399', '-F', 'n'],
      { timeoutMs: 5000 },
    );
  });

  it('reports cwd only, no command, for an idle shell (foreground group is just the shell itself)', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '12345 S+   -zsh', stderr: '' })
      .mockResolvedValueOnce({
        success: true,
        stdout: 'p12345\nfcwd\nn/Users/stas/projects/x\n',
        stderr: '',
      });

    const windows = await inspectTerminalAppWindows('Terminal');

    expect(windows).toEqual([{ cwd: '/Users/stas/projects/x', command: undefined }]);
  });

  it('never guesses a command from a finished-but-idle shell — identical to never-ran-anything', async () => {
    // Same ps output shape as the idle case above — by construction,
    // there is no way to distinguish "never ran anything" from "ran
    // something and already finished" from process state alone.
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '12345 S+   -zsh', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p12345\nfcwd\nn/Users/stas/x\n', stderr: '' });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/stas/x', command: undefined },
    ]);
  });

  it('handles multiple windows, each its own entry, never merged', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004, /dev/ttys007\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '1 S+ -zsh', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p1\nfcwd\nn/Users/a\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '2 R+ tilt up', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p2\nfcwd\nn/Users/b\n', stderr: '' });

    const windows = await inspectTerminalAppWindows('Terminal');

    expect(windows).toEqual([
      { cwd: '/Users/a', command: undefined },
      { cwd: '/Users/b', command: 'tilt up' },
    ]);
  });

  it('returns an empty array, not a throw, when no windows are open', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
    expect(await inspectTerminalAppWindows('Terminal')).toEqual([]);
  });

  it('returns an empty array when the osascript call itself fails', async () => {
    runCommand.mockResolvedValueOnce({
      success: false,
      message: 'not authorized',
      stdout: '',
      stderr: '',
      code: 1,
    });
    expect(await inspectTerminalAppWindows('Terminal')).toEqual([]);
  });

  it('reports undefined cwd/command, not a throw, when ps fails for a tty', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({ success: false, message: 'ps failed', stdout: '', stderr: '', code: 1 });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: undefined, command: undefined },
    ]);
  });

  it('reports undefined cwd, but keeps the command, when lsof fails', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '1 R+ npm run dev', stderr: '' })
      .mockResolvedValueOnce({ success: false, message: 'lsof failed', stdout: '', stderr: '', code: 1 });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: undefined, command: 'npm run dev' },
    ]);
  });

  it('treats a login wrapper (login -pf user /bin/zsh) as idle, not as the running command', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: '1 S+ login -pf stas /bin/zsh', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p1\nfcwd\nn/Users/stas\n', stderr: '' });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/stas', command: undefined },
    ]);
  });

  it('picks the non-shell process over the shell when a pipeline puts both in the foreground group', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: '/dev/ttys004\n', stderr: '' })
      .mockResolvedValueOnce({
        success: true,
        stdout: ['1 S+ -zsh', '2 R+ tail -f app.log'].join('\n'),
        stderr: '',
      })
      .mockResolvedValueOnce({ success: true, stdout: 'p2\nfcwd\nn/Users/logs\n', stderr: '' });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/logs', command: 'tail -f app.log' },
    ]);
  });
});

describe('inspectTerminalAppWindows("iTerm2")', () => {
  it('queries iTerm2\'s own scripting dictionary, not Terminal.app\'s', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

    await inspectTerminalAppWindows('iTerm2');

    const [, args] = runCommand.mock.calls[0]!;
    expect(args).toContain('tell application "iTerm2"');
  });
});
