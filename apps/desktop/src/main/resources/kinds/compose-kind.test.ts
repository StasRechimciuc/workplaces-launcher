import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposeKind } from './compose-kind';
import { composeResource } from './compose-spec';
import * as shellExec from '../../lib/shell-exec';
import { dockerTool } from '../../tools/docker-tool';

// A scripted `docker` CLI: whether the daemon is up, which projects
// `compose ls` reports, and what a Down command does.
vi.mock('../../lib/shell-exec', () => ({ runCommand: vi.fn(), runDetached: vi.fn() }));

const runCommand = vi.mocked(shellExec.runCommand);

let daemonUp = true;
let projects: { Name: string; Status: string; ConfigFiles: string }[] = [];
let downResult: 'ok' | 'fail' = 'ok';
const downs: { cwd: string | undefined; args: string[] }[] = [];

beforeEach(() => {
  daemonUp = true;
  projects = [];
  downResult = 'ok';
  downs.length = 0;
  runCommand.mockReset().mockImplementation(async (command, args, options) => {
    const ok = (stdout = '') => ({ success: true as const, stdout, stderr: '' });
    const fail = (message: string) => ({
      success: false as const,
      message,
      stdout: '',
      stderr: message,
      code: 1,
    });
    if (command === 'docker' && args[0] === 'info') return daemonUp ? ok() : fail('daemon down');
    if (command === 'docker' && args[0] === 'compose' && args[1] === 'ls') {
      return ok(JSON.stringify(projects));
    }
    if (command === 'docker' && args.includes('down')) {
      downs.push({ cwd: options?.cwd, args });
      if (downResult === 'fail') return fail('down exploded');
      projects = [];
      return ok();
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  });
});

const kind = createComposeKind({ captureTimeoutMs: 50, captureIntervalMs: 10 });
const spec = composeResource('/work/app/', 'docker compose down', true);
const running = (name = 'app') => ({
  Name: name,
  Status: 'running(2)',
  ConfigFiles: '/work/app/compose.yaml',
});

describe('compose kind', () => {
  it('identifies a stack by its normalized directory', () => {
    expect(spec).toEqual({
      kind: 'compose',
      identity: { directory: '/work/app' },
      label: 'Docker (app)',
      options: { downCommand: 'docker compose down', stopOnClose: true },
    });
  });

  it('captures the stack the step started as ours, with how to stop it', async () => {
    daemonUp = false; // Docker Desktop still closed before the restore
    const snapshot = await kind.snapshot(spec.identity);
    expect(snapshot).toEqual([]);
    daemonUp = true;
    projects = [running()];
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toEqual({
      found: true,
      handle: {
        directory: '/work/app',
        project: 'app',
        downCommand: 'docker compose down',
        stopOnClose: true,
      },
      preexisting: false,
    });
  });

  it('treats a stack that was already running as not ours', async () => {
    projects = [running()];
    const snapshot = await kind.snapshot(spec.identity);
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      preexisting: true,
    });
  });

  it('ignores stopped projects and other directories', async () => {
    projects = [
      { Name: 'app', Status: 'exited(2)', ConfigFiles: '/work/app/compose.yaml' },
      { Name: 'other', Status: 'running(1)', ConfigFiles: '/work/other/compose.yaml' },
    ];
    await expect(kind.capture(spec.identity, [], spec.options)).resolves.toMatchObject({
      found: false,
    });
  });

  it('stops an opted-in stack with its Down command, in its directory', async () => {
    projects = [running()];
    const handle = {
      directory: '/work/app',
      project: 'app',
      downCommand: 'docker compose down',
      stopOnClose: true,
    };
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(downs).toEqual([{ cwd: '/work/app', args: ['compose', 'down'] }]);
  });

  it('leaves a stack running when stop on close is off', async () => {
    projects = [running()];
    const handle = { directory: '/work/app', project: 'app', downCommand: '', stopOnClose: false };
    await expect(kind.close(handle)).resolves.toEqual({
      outcome: 'kept-running',
      detail: 'stop on close is off for this step',
    });
    expect(downs).toEqual([]);
  });

  it('reports a failed Down command and an already-stopped stack', async () => {
    const handle = { directory: '/work/app', project: 'app', downCommand: '', stopOnClose: true };
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'already-gone' });
    projects = [running()];
    downResult = 'fail';
    await expect(kind.close(handle)).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('is unsure, never "gone", when compose ls itself fails', async () => {
    runCommand.mockImplementation(async (command, args) =>
      command === 'docker' && args[0] === 'info'
        ? { success: true, stdout: '', stderr: '' }
        : { success: false, message: 'boom', stdout: '', stderr: 'boom', code: 1 },
    );
    const handle = { directory: '/work/app', project: 'app', downCommand: '', stopOnClose: true };
    await expect(kind.check(handle, spec.identity)).resolves.toMatchObject({ state: 'unknown' });
  });
});

describe('docker step resources', () => {
  it('declares a Compose stack, and nothing for Tilt', async () => {
    const compose = dockerTool.validate({
      directory: '/work/app',
      engine: 'compose',
      upCommand: 'docker compose up -d',
      stopOnClose: true,
    });
    const tilt = dockerTool.validate({
      directory: '/work/app',
      engine: 'tilt',
      upCommand: 'tilt up',
    });
    if (!compose.valid || !tilt.valid) throw new Error('fixture params invalid');
    await expect(dockerTool.resources!(compose.data)).resolves.toEqual([
      composeResource('/work/app', '', true),
    ]);
    await expect(dockerTool.resources!(tilt.data)).resolves.toEqual([]);
  });
});
