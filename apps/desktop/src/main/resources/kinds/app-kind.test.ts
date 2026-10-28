import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WlHelperClient } from '../../platform/macos/wl-helper-client';
import { appResourceFor, createAppKind } from './app-kind';
import * as bundleId from '../../platform/macos/bundle-id';

vi.mock('../../platform/macos/bundle-id', () => ({ readBundleId: vi.fn() }));

type Instance = { pid: number; startedAt: number | null };

/** A fake helper whose running instances and quit behavior the test scripts. */
function fakeHelper(): {
  helper: Pick<WlHelperClient, 'request'>;
  running: Instance[];
  quitOutcome: 'quit' | 'not-running' | 'still-running';
  failWith: { code: string; message: string } | null;
  quits: number[];
} {
  const state = {
    running: [] as Instance[],
    quitOutcome: 'quit' as 'quit' | 'not-running' | 'still-running',
    failWith: null as { code: string; message: string } | null,
    quits: [] as number[],
    helper: {} as Pick<WlHelperClient, 'request'>,
  };
  state.helper = {
    request: (async (method: string, params: { pid?: number }) => {
      if (state.failWith) return { ok: false, error: state.failWith };
      if (method === 'isRunning') {
        return {
          ok: true,
          result: {
            running: state.running.length > 0,
            pids: state.running.map((a) => a.pid),
            apps: state.running,
          },
        };
      }
      if (method === 'quitApp') {
        state.quits.push(params.pid!);
        if (state.quitOutcome === 'quit') {
          state.running = state.running.filter((a) => a.pid !== params.pid);
        }
        return { ok: true, result: { outcome: state.quitOutcome } };
      }
      throw new Error(`unexpected ${method}`);
    }) as unknown as WlHelperClient['request'],
  };
  return state;
}

const SPOTIFY = { bundleId: 'com.spotify.client' };

describe('app kind', () => {
  let fake: ReturnType<typeof fakeHelper>;
  let kind: ReturnType<typeof createAppKind>;

  beforeEach(() => {
    fake = fakeHelper();
    kind = createAppKind(fake.helper, { captureTimeoutMs: 200, captureIntervalMs: 10 });
  });

  it('captures the instance the step started as ours', async () => {
    const snapshot = await kind.snapshot(SPOTIFY);
    fake.running = [{ pid: 42, startedAt: 1000 }];
    await expect(kind.capture(SPOTIFY, snapshot)).resolves.toEqual({
      found: true,
      handle: { bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 },
      preexisting: false,
    });
  });

  it('captures an app that was already running as not ours', async () => {
    fake.running = [{ pid: 7, startedAt: 500 }];
    const snapshot = await kind.snapshot(SPOTIFY);
    const result = await kind.capture(SPOTIFY, snapshot);
    expect(result).toMatchObject({ found: true, preexisting: true, handle: { pid: 7 } });
  });

  it('treats a pid reused by a new process as a new instance', async () => {
    fake.running = [{ pid: 7, startedAt: 500 }];
    const snapshot = await kind.snapshot(SPOTIFY);
    fake.running = [{ pid: 7, startedAt: 900 }];
    await expect(kind.capture(SPOTIFY, snapshot)).resolves.toMatchObject({ preexisting: false });
  });

  it('never claims an app as ours when the before-snapshot failed', async () => {
    fake.running = [{ pid: 42, startedAt: 1000 }];
    await expect(kind.capture(SPOTIFY, null)).resolves.toMatchObject({ preexisting: true });
  });

  it('reports why nothing was captured', async () => {
    await expect(kind.capture(SPOTIFY, [])).resolves.toEqual({
      found: false,
      reason: expect.stringContaining("wasn't running"),
    });
    await expect(kind.capture({ path: 'x' }, [])).resolves.toMatchObject({ found: false });
  });

  it('checks a handle by pid and start time, and is unsure rather than wrong when the helper is down', async () => {
    const handle = { bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 };
    fake.running = [{ pid: 42, startedAt: 1000 }];
    await expect(kind.check(handle, SPOTIFY)).resolves.toEqual({ state: 'alive' });
    fake.running = [{ pid: 42, startedAt: 2000 }];
    await expect(kind.check(handle, SPOTIFY)).resolves.toEqual({ state: 'gone' });
    fake.failWith = { code: 'unavailable', message: 'helper missing' };
    await expect(kind.check(handle, SPOTIFY)).resolves.toEqual({
      state: 'unknown',
      reason: 'helper missing',
    });
  });

  it('quits only the recorded instance', async () => {
    fake.running = [{ pid: 42, startedAt: 1000 }];
    const handle = { bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 };
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(fake.quits).toEqual([42]);
  });

  it('never quits a process that merely reuses the recorded pid', async () => {
    fake.running = [{ pid: 42, startedAt: 9999 }];
    const handle = { bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 };
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'already-gone' });
    expect(fake.quits).toEqual([]);
  });

  it('leaves an app that asks to stay open running and says why', async () => {
    fake.running = [{ pid: 42, startedAt: 1000 }];
    fake.quitOutcome = 'still-running';
    const result = await kind.close({ bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 });
    expect(result).toMatchObject({ outcome: 'kept-running' });
  });

  it('reports a helper failure while closing instead of guessing', async () => {
    fake.failWith = { code: 'unavailable', message: 'helper missing' };
    const result = await kind.close({ bundleId: 'com.spotify.client', pid: 42, startedAt: 1000 });
    expect(result).toEqual({ outcome: 'failed', detail: 'helper missing' });
  });

  it('finds a live instance whoever opened it', async () => {
    await expect(kind.findLive(SPOTIFY)).resolves.toBeNull();
    fake.running = [{ pid: 3, startedAt: 1 }];
    await expect(kind.findLive(SPOTIFY)).resolves.toEqual({
      bundleId: 'com.spotify.client',
      pid: 3,
      startedAt: 1,
    });
  });
});

describe('appResourceFor', () => {
  it('tracks an app bundle by its bundle id', async () => {
    vi.mocked(bundleId.readBundleId).mockResolvedValue('com.spotify.client');
    await expect(appResourceFor('/Applications/Spotify.app', 'Spotify')).resolves.toEqual([
      { kind: 'app', identity: { bundleId: 'com.spotify.client' }, label: 'Spotify' },
    ]);
  });

  it('leaves a bare app name or an unreadable bundle untracked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(appResourceFor('Spotify', 'Spotify')).resolves.toEqual([]);
    vi.mocked(bundleId.readBundleId).mockResolvedValue(null);
    await expect(appResourceFor('/Applications/Gone.app', 'Gone')).resolves.toEqual([]);
    errorSpy.mockRestore();
  });
});
