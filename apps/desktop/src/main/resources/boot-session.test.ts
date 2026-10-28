import { describe, expect, it, vi } from 'vitest';
import { readBootSessionUuid } from './boot-session';
import * as shellExec from '../lib/shell-exec';

vi.mock('../lib/shell-exec', () => ({ runCommand: vi.fn() }));

const runCommand = vi.mocked(shellExec.runCommand);

describe('readBootSessionUuid', () => {
  it('returns the uuid sysctl reports', async () => {
    runCommand.mockResolvedValue({
      success: true,
      stdout: '5D3C2A1B-0000-4000-8000-0123456789AB\n',
      stderr: '',
    });
    await expect(readBootSessionUuid()).resolves.toBe('5D3C2A1B-0000-4000-8000-0123456789AB');
    expect(runCommand).toHaveBeenCalledWith('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
      timeoutMs: 5000,
    });
  });

  it('returns null — "different session" — when it can’t be read or looks wrong', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runCommand.mockResolvedValue({
      success: false,
      message: 'boom',
      stdout: '',
      stderr: '',
      code: 1,
    });
    await expect(readBootSessionUuid()).resolves.toBeNull();
    runCommand.mockResolvedValue({ success: true, stdout: 'garbage', stderr: '' });
    await expect(readBootSessionUuid()).resolves.toBeNull();
    errorSpy.mockRestore();
  });
});
