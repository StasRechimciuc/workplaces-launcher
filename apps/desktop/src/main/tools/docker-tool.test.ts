import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { dockerTool } from './docker-tool';
import { getPlatformLauncher } from '../platform';
import { runCommand } from '../lib/shell-exec';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

vi.mock('../lib/shell-exec', () => ({
  runCommand: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const mockedRunCommand = vi.mocked(runCommand);
const openTerminal = vi.fn();

const validCompose = {
  directory: '/Users/stas/projects/x',
  engine: 'compose' as const,
  upCommand: 'docker compose -f compose.yaml -p x up -d --wait --wait-timeout 120',
};

const validTilt = {
  directory: '/Users/stas/projects/x',
  engine: 'tilt' as const,
  upCommand: 'tilt up',
};

beforeEach(() => {
  mockedRunCommand.mockReset();
  mockedGetPlatformLauncher.mockReset();
  openTerminal.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp: vi.fn(),
    openInApp: vi.fn(),
    openUrlInBrowserProfile: vi.fn(),
    openTerminal,
    openFileDefault: vi.fn(),
    openUrlDefault: vi.fn(),
  });
});

describe('dockerTool', () => {
  it('has type "docker"', () => {
    expect(dockerTool.type).toBe('docker');
  });

  describe('validate', () => {
    it('accepts a valid compose step, defaulting downCommand/stopOnClose', () => {
      const result = dockerTool.validate(validCompose);
      expect(result).toEqual({
        valid: true,
        data: { ...validCompose, downCommand: '', stopOnClose: false },
      });
    });

    it('accepts a valid tilt step', () => {
      expect(dockerTool.validate(validTilt).valid).toBe(true);
    });

    it('rejects a relative directory', () => {
      const result = dockerTool.validate({ ...validCompose, directory: 'my-project' });
      expect(result.valid).toBe(false);
    });

    it('rejects an empty upCommand', () => {
      const result = dockerTool.validate({ ...validCompose, upCommand: '' });
      expect(result.valid).toBe(false);
    });

    it('rejects an upCommand with an unmatched quote', () => {
      const result = dockerTool.validate({
        ...validCompose,
        upCommand: 'docker compose -f "unterminated up -d',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects -v in downCommand', () => {
      const result = dockerTool.validate({
        ...validCompose,
        downCommand: 'docker compose down -v',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects --volumes in downCommand', () => {
      const result = dockerTool.validate({
        ...validCompose,
        downCommand: 'docker compose down --volumes',
      });
      expect(result.valid).toBe(false);
    });

    it('accepts a downCommand with no volume flags', () => {
      const result = dockerTool.validate({ ...validCompose, downCommand: 'docker compose down' });
      expect(result.valid).toBe(true);
    });

    it('accepts stopOnClose explicitly set to true', () => {
      const result = dockerTool.validate({ ...validCompose, stopOnClose: true });
      expect(result.valid && result.data.stopOnClose).toBe(true);
    });
  });

  describe('run — compose engine', () => {
    it('checks the Docker daemon first, then runs the up command via runCommand', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // compose up

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(mockedRunCommand).toHaveBeenNthCalledWith(1, 'docker', ['info'], { timeoutMs: 8_000 });
      expect(mockedRunCommand).toHaveBeenNthCalledWith(
        2,
        'docker',
        ['compose', '-f', 'compose.yaml', '-p', 'x', 'up', '-d', '--wait', '--wait-timeout', '120'],
        { cwd: '/Users/stas/projects/x', timeoutMs: 130_000 },
      );
      expect(result.success).toBe(true);
      expect(openTerminal).not.toHaveBeenCalled();
    });

    it('reports a clear, distinct message when the daemon is down', async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'connect ECONNREFUSED',
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        code: 1,
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_DAEMON_DOWN.code);
      expect(result.message.toLowerCase()).toContain('running');
      expect(mockedRunCommand).toHaveBeenCalledTimes(1); // never attempted the up command
    });

    it("reports a clear, distinct message when Docker isn't installed", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'spawn docker ENOENT',
        stdout: '',
        stderr: '',
        code: null,
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_DAEMON_DOWN.code);
      expect(result.message.toLowerCase()).toContain("isn't installed");
    });

    it('reports a real failure when the up command itself fails', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'exit 1',
        stdout: '',
        stderr: 'service "web" failed to build',
        code: 1,
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_STEP_FAILED.code);
      expect(result.message).toContain('service "web" failed to build');
    });
  });

  describe('run — tilt engine', () => {
    it('checks the daemon, then opens a terminal via the platform launcher, not runCommand', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info
      openTerminal.mockResolvedValueOnce({
        success: true,
        message: 'Opened a terminal at /Users/stas/projects/x.',
      });

      const result = await dockerTool.run(
        { ...validTilt, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(openTerminal).toHaveBeenCalledWith('/Users/stas/projects/x', ['tilt up']);
      expect(mockedRunCommand).toHaveBeenCalledTimes(1); // only the daemon check
      expect(result.success).toBe(true);
    });

    it('propagates a terminal-open failure as a real failure', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      openTerminal.mockResolvedValueOnce({ success: false, message: "couldn't open Terminal" });

      const result = await dockerTool.run(
        { ...validTilt, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_STEP_FAILED.code);
    });
  });

  describe('teardown', () => {
    it('defaults to "docker compose down" for the compose engine when downCommand is empty', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // down

      const result = await dockerTool.teardown({
        ...validCompose,
        downCommand: '',
        stopOnClose: false,
      });

      expect(mockedRunCommand).toHaveBeenNthCalledWith(2, 'docker', ['compose', 'down'], {
        cwd: '/Users/stas/projects/x',
        timeoutMs: 60_000,
      });
      expect(result.success).toBe(true);
    });

    it('defaults to "tilt down" for the tilt engine, via runCommand not openTerminal', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // tilt down

      const result = await dockerTool.teardown({
        ...validTilt,
        downCommand: '',
        stopOnClose: false,
      });

      expect(mockedRunCommand).toHaveBeenNthCalledWith(2, 'tilt', ['down'], {
        cwd: '/Users/stas/projects/x',
        timeoutMs: 60_000,
      });
      expect(openTerminal).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('uses an explicit downCommand over the engine default when one is set', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });

      await dockerTool.teardown({
        ...validCompose,
        downCommand: 'docker compose -p x down',
        stopOnClose: false,
      });

      expect(mockedRunCommand).toHaveBeenNthCalledWith(
        2,
        'docker',
        ['compose', '-p', 'x', 'down'],
        {
          cwd: '/Users/stas/projects/x',
          timeoutMs: 60_000,
        },
      );
    });
  });

  describe('detail', () => {
    it('degrades gracefully with no directory set', () => {
      expect(dockerTool.detail?.({})).toBe('Starts the configured Docker environment.');
    });

    it('names the engine and directory', () => {
      expect(dockerTool.detail?.({ directory: '/x', engine: 'tilt' })).toBe('Starts Tilt in /x.');
      expect(dockerTool.detail?.({ directory: '/x', engine: 'compose' })).toBe(
        'Starts Docker Compose in /x.',
      );
    });
  });

  describe('expand', () => {
    it('returns undefined with no directory set', () => {
      expect(dockerTool.expand?.({})).toBeUndefined();
    });

    it('includes directory and up command rows', () => {
      const rows = dockerTool.expand?.({ directory: '/x', upCommand: 'tilt up' });
      expect(rows).toEqual([
        { i: 'folder', label: 'Directory', mono: '/x' },
        { i: 'terminal', label: 'Up command', mono: 'tilt up' },
      ]);
    });
  });
});
