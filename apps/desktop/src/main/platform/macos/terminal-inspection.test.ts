import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectTerminalAppWindows } from './terminal-inspection';
import * as shellExec from '../../lib/shell-exec';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);

/**
 * `ps -A` output for a Terminal.app (or iTerm2) with one session per
 * tty: each session is a `login` child of the app's process, holding
 * its tty — the real shape on macOS. Plus an unrelated process on
 * another tty, which must never be picked up.
 */
function processTree(
  ttys: string[],
  root = '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
) {
  const lines = [
    `100 1 ??       ${root}`,
    ...ttys.map((tty, i) => `${200 + i} 100 ${tty}  login -pf stas`),
    '900 1 ttys099  /bin/zsh -il',
  ];
  return { success: true as const, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

beforeEach(() => {
  runCommand.mockClear();
});

describe('inspectTerminalAppWindows("Terminal")', () => {
  it('reports cwd + command for a window actively running a non-shell foreground job', async () => {
    runCommand
      // tty of every window
      .mockResolvedValueOnce(processTree(['ttys004']))
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
      .mockResolvedValueOnce(processTree(['ttys004']))
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
      .mockResolvedValueOnce(processTree(['ttys004']))
      .mockResolvedValueOnce({ success: true, stdout: '12345 S+   -zsh', stderr: '' })
      .mockResolvedValueOnce({
        success: true,
        stdout: 'p12345\nfcwd\nn/Users/stas/x\n',
        stderr: '',
      });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/stas/x', command: undefined },
    ]);
  });

  it('handles multiple windows, each its own entry, never merged', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys007', 'ttys004']))
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
    runCommand.mockResolvedValueOnce(processTree([]));
    expect(await inspectTerminalAppWindows('Terminal')).toEqual([]);
  });

  it('returns null — a failure, not "nothing open" — when the process table can’t be read', async () => {
    runCommand.mockResolvedValueOnce({
      success: false,
      message: 'ps failed',
      stdout: '',
      stderr: '',
      code: 1,
    });
    expect(await inspectTerminalAppWindows('Terminal')).toBeNull();
  });

  it('reports undefined cwd/command, not a throw, when ps fails for a tty', async () => {
    runCommand.mockResolvedValueOnce(processTree(['ttys004'])).mockResolvedValueOnce({
      success: false,
      message: 'ps failed',
      stdout: '',
      stderr: '',
      code: 1,
    });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: undefined, command: undefined },
    ]);
  });

  it('reports undefined cwd, but keeps the command, when lsof fails', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys004']))
      .mockResolvedValueOnce({ success: true, stdout: '1 R+ npm run dev', stderr: '' })
      .mockResolvedValueOnce({
        success: false,
        message: 'lsof failed',
        stdout: '',
        stderr: '',
        code: 1,
      });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: undefined, command: 'npm run dev' },
    ]);
  });

  it('treats a login wrapper (login -pf user /bin/zsh) as idle, not as the running command', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys004']))
      .mockResolvedValueOnce({ success: true, stdout: '1 S+ login -pf stas /bin/zsh', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p1\nfcwd\nn/Users/stas\n', stderr: '' });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/stas', command: undefined },
    ]);
  });

  it('picks the non-shell process over the shell when a pipeline puts both in the foreground group', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys004']))
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
  it('finds iTerm2’s sessions under its iTermServer process, not Terminal.app’s', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys010'], '/Users/stas/Library/iTermServer-3.5.0'))
      .mockResolvedValueOnce({ success: true, stdout: '1 S+ -zsh', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'p1\nfcwd\nn/Users/stas\n', stderr: '' });

    expect(await inspectTerminalAppWindows('iTerm2')).toEqual([
      { cwd: '/Users/stas', command: undefined },
    ]);
    expect(runCommand.mock.calls[1]![1]).toEqual(['-t', 'ttys010', '-o', 'pid=,stat=,command=']);
  });
});

describe('never asks for Automation', () => {
  it('reads only the process table — no osascript, ever', async () => {
    runCommand.mockResolvedValue(processTree(['ttys004']));
    await inspectTerminalAppWindows('Terminal');
    await inspectTerminalAppWindows('iTerm2');
    expect(runCommand.mock.calls.every(([command]) => command !== 'osascript')).toBe(true);
  });
});

describe('a tracked terminal’s own output logger', () => {
  it('reports the user’s command, never the tee the script pipes it through', async () => {
    runCommand
      .mockResolvedValueOnce(processTree(['ttys004']))
      .mockResolvedValueOnce({
        success: true,
        stdout: [
          '1 S+ /bin/zsh -l /tmp/x.command',
          '2 S+ tee -a /tmp/x.out',
          '3 S+ npm run dev',
        ].join('\n'),
        stderr: '',
      })
      .mockResolvedValueOnce({ success: true, stdout: 'p3\nfcwd\nn/Users/app\n', stderr: '' });

    expect(await inspectTerminalAppWindows('Terminal')).toEqual([
      { cwd: '/Users/app', command: 'npm run dev' },
    ]);
  });
});
