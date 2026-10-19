import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppRunning, quitApp, waitForAppRunning } from './process-control';
import * as shellExec from '../../lib/shell-exec';

vi.mock('../../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const runCommand = vi.mocked(shellExec.runCommand);

beforeEach(() => {
  runCommand.mockClear();
});

describe('isAppRunning', () => {
  it('returns true when osascript reports "true"', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: 'true\n', stderr: '' });

    const result = await isAppRunning('Spotify');

    expect(runCommand).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'on run argv', '-e', 'return application (item 1 of argv) is running', '-e', 'end run', 'Spotify'],
      { timeoutMs: 5000 },
    );
    expect(result).toBe(true);
  });

  it('returns false when osascript reports "false"', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: 'false\n', stderr: '' });

    expect(await isAppRunning('Spotify')).toBe(false);
  });

  it('returns false, not a throw, when the osascript call itself fails', async () => {
    runCommand.mockResolvedValueOnce({
      success: false,
      message: 'command not found',
      stdout: '',
      stderr: '',
      code: 127,
    });

    expect(await isAppRunning('Ghost App')).toBe(false);
  });

  it('never lets a hostile app name break out of the AppleScript source — it must arrive as a plain argv value, not interpolated into the script text', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: 'false\n', stderr: '' });
    const hostile = 'X" & (do shell script "touch pwned") & "';

    await isAppRunning(hostile);

    const [, args] = runCommand.mock.calls[0]!;
    // The script text itself (every '-e' argument) must be the fixed
    // handler only — never contain the hostile value at all.
    const scriptArgs = args!.filter((_, i) => i % 2 === 0 || args![i - 1] === '-e').slice(0, -1);
    scriptArgs.forEach((scriptLine) => {
      expect(scriptLine).not.toContain(hostile);
      expect(scriptLine).not.toContain('do shell script');
    });
    // The hostile value must appear exactly once, as the final literal
    // argv entry — never split across/concatenated into the script.
    expect(args).toEqual([
      '-e',
      'on run argv',
      '-e',
      'return application (item 1 of argv) is running',
      '-e',
      'end run',
      hostile,
    ]);
  });
});

describe('quitApp', () => {
  it('reports success when osascript succeeds', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

    const result = await quitApp('Visual Studio Code');

    expect(runCommand).toHaveBeenCalledWith(
      'osascript',
      [
        '-e',
        'on run argv',
        '-e',
        'tell application (item 1 of argv) to quit',
        '-e',
        'end run',
        'Visual Studio Code',
      ],
      { timeoutMs: 5000 },
    );
    expect(result).toEqual({ success: true, message: 'Quit Visual Studio Code.' });
  });

  it('reports failure without throwing', async () => {
    runCommand.mockResolvedValueOnce({
      success: false,
      message: "application isn't running",
      stdout: '',
      stderr: '',
      code: 1,
    });

    const result = await quitApp('Ghost App');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Ghost App');
    expect(result.message).toContain("application isn't running");
  });
});

describe('waitForAppRunning', () => {
  // Small real intervalMs/timeoutMs throughout instead of fake timers —
  // mixing vi.useFakeTimers() with the awaited isAppRunning() promise
  // inside the polling loop is a known-flaky combination; real tiny
  // delays keep these tests fast without that risk.

  it('resolves detected:true immediately, without waiting a full interval, when already running on the first check', async () => {
    runCommand.mockResolvedValueOnce({ success: true, stdout: 'true\n', stderr: '' });

    const result = await waitForAppRunning('Figma', { intervalMs: 5000, timeoutMs: 20000 });

    expect(result.detected).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('polls multiple times before detecting the app running', async () => {
    runCommand
      .mockResolvedValueOnce({ success: true, stdout: 'false\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'false\n', stderr: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'true\n', stderr: '' });

    const result = await waitForAppRunning('ProtonVPN', { intervalMs: 1, timeoutMs: 1000 });

    expect(result.detected).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(3);
  });

  it('gives up and reports detected:false once the timeout elapses', async () => {
    runCommand.mockResolvedValue({ success: true, stdout: 'false\n', stderr: '' });

    const result = await waitForAppRunning('Never Launches', { intervalMs: 5, timeoutMs: 20 });

    expect(result.detected).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(20);
  });

  it('never throws when isAppRunning reports false due to an underlying command failure', async () => {
    runCommand.mockResolvedValue({
      success: false,
      message: 'command not found',
      stdout: '',
      stderr: '',
      code: 127,
    });

    await expect(
      waitForAppRunning('Ghost App', { intervalMs: 5, timeoutMs: 15 }),
    ).resolves.toEqual({ detected: false, elapsedMs: expect.any(Number) });
  });
});
