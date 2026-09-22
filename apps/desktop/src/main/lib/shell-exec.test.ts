import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileImport, spawn as spawnImport } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

const execFile = vi.mocked(execFileImport);
const spawn = vi.mocked(spawnImport);

beforeEach(() => {
  execFile.mockClear();
  spawn.mockClear();
});

describe('runCommand', () => {
  it('resolves success with stdout/stderr on a clean exit', async () => {
    // execFile's promisified form resolves via the callback's 3rd/4th
    // args — the mock here plays the role of node:child_process.execFile
    // itself, callback-style, matching what util.promisify wraps.
    execFile.mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: 'ok',
        stderr: '',
      });
      return {} as ReturnType<typeof execFileImport>;
    }) as unknown as typeof execFileImport);

    const { runCommand } = await import('./shell-exec');
    const result = await runCommand('docker', ['compose', 'up']);

    expect(execFile).toHaveBeenCalledWith(
      'docker',
      ['compose', 'up'],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
    expect(result).toEqual({ success: true, stdout: 'ok', stderr: '' });
  });

  it('resolves failure (never rejects) when the command errors', async () => {
    execFile.mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error('command not found'), {
        code: 127,
        stdout: '',
        stderr: 'not found',
      });
      (cb as (err: Error) => void)(err);
      return {} as ReturnType<typeof execFileImport>;
    }) as unknown as typeof execFileImport);

    const { runCommand } = await import('./shell-exec');
    const result = await runCommand('not-a-real-command', []);

    expect(result).toEqual({
      success: false,
      message: 'command not found',
      stdout: '',
      stderr: 'not found',
      code: 127,
    });
  });
});

describe('runDetached', () => {
  function mockSpawnedChild(): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
    child.unref = vi.fn();
    spawn.mockReturnValue(child as unknown as ReturnType<typeof spawnImport>);
    return child;
  }

  it('always spawns with shell:false, detached, stdio ignored', async () => {
    const child = mockSpawnedChild();
    const { runDetached } = await import('./shell-exec');

    const pending = runDetached('C:\\Program Files\\App\\App.exe', ['C:\\projects\\x']);
    child.emit('spawn');
    await pending;

    expect(spawn).toHaveBeenCalledWith('C:\\Program Files\\App\\App.exe', ['C:\\projects\\x'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
  });

  it("resolves success as soon as the 'spawn' event fires, and unrefs the child", async () => {
    const child = mockSpawnedChild();
    const { runDetached } = await import('./shell-exec');

    const pending = runDetached('App.exe', []);
    child.emit('spawn');
    const result = await pending;

    expect(result).toEqual({ success: true, stdout: '', stderr: '' });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("resolves failure (never rejects) when the 'error' event fires", async () => {
    const child = mockSpawnedChild();
    const { runDetached } = await import('./shell-exec');

    const pending = runDetached('NotAnApp.exe', []);
    child.emit('error', new Error('ENOENT'));
    const result = await pending;

    expect(result).toEqual({
      success: false,
      message: 'ENOENT',
      stdout: '',
      stderr: '',
      code: null,
    });
  });
});
