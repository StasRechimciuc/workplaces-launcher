import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { dockerTool, ensureDockerDaemonRunning } from './docker-tool';
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

    it('rejects --volumes=true in downCommand', () => {
      const result = dockerTool.validate({
        ...validCompose,
        downCommand: 'docker compose down --volumes=true',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects -v=true in downCommand', () => {
      const result = dockerTool.validate({
        ...validCompose,
        downCommand: 'docker compose down -v=true',
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

    it("reports a durationMs that includes the daemon-wait time, not just the compose command's own", async () => {
      const POLL_DELAY_MS = 30;
      mockedRunCommand
        .mockResolvedValueOnce({
          success: false,
          message: 'connect ECONNREFUSED',
          stdout: '',
          stderr: '',
          code: 1,
        }) // docker info — down
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ success: true, stdout: '', stderr: '' }), POLL_DELAY_MS),
            ),
        ) // docker info — up after a real delay
        .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // compose up
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp: vi.fn().mockResolvedValueOnce({ success: true, message: 'Launched Docker.' }),
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(POLL_DELAY_MS);
    });

    it('tries to launch Docker Desktop and waits for the daemon when it was down, then proceeds', async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'connect ECONNREFUSED',
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        code: 1,
      }); // docker info — down
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info — up after launch
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // compose up
      const launchApp = vi
        .fn()
        .mockResolvedValueOnce({ success: true, message: 'Launched Docker.' });
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(launchApp).toHaveBeenCalledWith('Docker');
      expect(mockedRunCommand).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });

    it('reports a clear, distinct message when the daemon is still down after Docker Desktop fails to launch', async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'connect ECONNREFUSED',
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        code: 1,
      });
      const launchApp = vi
        .fn()
        .mockResolvedValueOnce({ success: false, message: 'Failed to launch Docker.' });
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
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

    it("reports a clear, distinct message when Docker isn't installed, without attempting to launch it", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'spawn docker ENOENT',
        stdout: '',
        stderr: '',
        code: null,
      });
      const launchApp = vi.fn();
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_DAEMON_DOWN.code);
      expect(result.message.toLowerCase()).toContain("isn't installed");
      expect(launchApp).not.toHaveBeenCalled();
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

    it('(regression) prefixes the failure message with whether Docker Desktop was already running — closing the "doesn\'t even say Docker opened" gap', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info — already up
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'exit 1',
        stdout: '',
        stderr: 'no configuration file provided: not found',
        code: 1,
      });

      const result = await dockerTool.run(
        { ...validCompose, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.message.startsWith('Docker Desktop was already running.')).toBe(true);
      expect(result.message).toContain('no configuration file provided');
    });
  });

  describe('ensureDockerDaemonRunning', () => {
    it('gives up and reports a clear timeout message once the poll window elapses', async () => {
      mockedRunCommand.mockResolvedValue({
        success: false,
        message: 'connect ECONNREFUSED',
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        code: 1,
      }); // every docker info call stays down
      const launchApp = vi
        .fn()
        .mockResolvedValueOnce({ success: true, message: 'Launched Docker.' });
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await ensureDockerDaemonRunning({ intervalMs: 5, timeoutMs: 20 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message.toLowerCase()).toContain("didn't finish starting");
      }
    });

    it('returns success as soon as a poll finds the daemon up', async () => {
      mockedRunCommand
        .mockResolvedValueOnce({
          success: false,
          message: 'connect ECONNREFUSED',
          stdout: '',
          stderr: '',
          code: 1,
        })
        .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      const launchApp = vi
        .fn()
        .mockResolvedValueOnce({ success: true, message: 'Launched Docker.' });
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await ensureDockerDaemonRunning({ intervalMs: 5, timeoutMs: 5_000 });

      expect(result).toEqual({ success: true, wasAlreadyRunning: false });
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

      expect(openTerminal).toHaveBeenCalledWith('/Users/stas/projects/x', ['tilt up'], {
        marker: expect.stringMatching(/^wl-[0-9a-f]{12}$/),
      });
      expect(mockedRunCommand).toHaveBeenCalledTimes(1); // only the daemon check
      expect(result.success).toBe(true);
    });

    it('propagates a terminal-open failure as a real failure, using the shared TERMINAL_START_FAILED code (not a Docker-specific one)', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      openTerminal.mockResolvedValueOnce({
        success: false,
        message: "couldn't open Terminal",
        detail: {
          cwd: '/Users/stas/projects/x',
          openFailed: { stage: 'open', reason: "couldn't open Terminal" },
          commands: [{ index: 0, command: 'tilt up', status: 'not-run' }],
        },
      });

      const result = await dockerTool.run(
        { ...validTilt, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.TERMINAL_START_FAILED.code);
    });

    it('propagates a real Tilt command failure using TERMINAL_COMMAND_FAILED, with the entry detail passed through', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' });
      const entryDetail = {
        cwd: '/Users/stas/projects/x',
        commands: [
          {
            index: 0,
            command: 'tilt up',
            status: 'failed',
            exitCode: 1,
            reason: 'no Tiltfile found',
          },
        ],
      };
      openTerminal.mockResolvedValueOnce({
        success: false,
        message: '"tilt up" failed with exit code 1 shortly after the terminal opened.',
        detail: entryDetail,
      });

      const result = await dockerTool.run(
        { ...validTilt, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.TERMINAL_COMMAND_FAILED.code);
      expect(result.details).toEqual({ entries: [entryDetail] });
    });

    it('(regression) prefixes the tilt-branch failure message with the daemon status too, not just the compose branch', async () => {
      mockedRunCommand.mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // docker info — already up
      openTerminal.mockResolvedValueOnce({
        success: false,
        message: '"docker compose up" failed with exit code 1 shortly after the terminal opened.',
        detail: {
          cwd: '/Users/stas/projects/x',
          commands: [{ index: 0, command: 'docker compose up', status: 'failed', exitCode: 1 }],
        },
      });

      const result = await dockerTool.run(
        { ...validTilt, downCommand: '', stopOnClose: false },
        { workspaceId: 'w1' },
      );

      expect(result.message.startsWith('Docker Desktop was already running.')).toBe(true);
    });
  });

  describe('teardown', () => {
    it("reports a durationMs that includes the daemon-check wait time, not just the down command's own", async () => {
      const CHECK_DELAY_MS = 30;
      mockedRunCommand
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ success: true, stdout: '', stderr: '' }), CHECK_DELAY_MS),
            ),
        ) // docker info — slow
        .mockResolvedValueOnce({ success: true, stdout: '', stderr: '' }); // compose down

      const result = await dockerTool.teardown({
        ...validCompose,
        downCommand: '',
        stopOnClose: false,
      });

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(CHECK_DELAY_MS);
    });

    it('reports the daemon-down message with a manual-start instruction, never attempting to launch Docker itself', async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: false,
        message: 'connect ECONNREFUSED',
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        code: 1,
      });
      const launchApp = vi.fn();
      mockedGetPlatformLauncher.mockReturnValue({
        launchApp,
        openInApp: vi.fn(),
        openUrlInBrowserProfile: vi.fn(),
        openTerminal,
        openFileDefault: vi.fn(),
        openUrlDefault: vi.fn(),
      });

      const result = await dockerTool.teardown({
        ...validCompose,
        downCommand: '',
        stopOnClose: false,
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe(ERROR_CODES.DOCKER_DAEMON_DOWN.code);
      expect(result.message.toLowerCase()).toContain('start docker desktop');
      expect(launchApp).not.toHaveBeenCalled();
      expect(mockedRunCommand).toHaveBeenCalledTimes(1);
    });

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
