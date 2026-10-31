import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WlHelperClient } from '../../platform/macos/wl-helper-client';
import type { TerminalSessionState } from '../../platform/macos/terminal-session';
import { createTerminalKind } from './terminal-kind';
import { markerOf, terminalWindowResource } from './terminal-spec';

// A scripted world: Terminal's windows, the shell's start time, the
// session state the script reports, and which processes are alive.
const spec = terminalWindowResource('~/app', ['npm run dev'], 0);
const marker = markerOf(spec.identity);

let windowState: 'alive' | 'gone' | 'blocked' = 'alive';
let closeOutcome: 'closed' | 'blocked' | 'still-open' = 'closed';
let shellStartedAt: number | null = 1000;
let session: TerminalSessionState | null = 'running';
let info: { tty: string; shellPid: number; writtenAt: number } | null = {
  tty: '/dev/ttys004',
  shellPid: 500,
  writtenAt: Date.now() + 60_000,
};
let captureOk = true;
/** The marked window shows up in Accessibility only once Terminal is brought forward. */
let visibleAfterActivate = true;
let activated = false;
let closeUnreachableOnce = false;
let alive = new Set([500, 501, 502]);
const signals: [number, string][] = [];
const reruns: string[] = [];
const requests: { method: string; params: Record<string, unknown> }[] = [];
const downs: [string, string][] = [];
let downOk = true;

const helper = {
  request: (async (method: string, params: Record<string, unknown>) => {
    requests.push({ method, params });
    switch (method) {
      case 'listWindows':
        return {
          ok: true,
          result: [
            { windowId: 1, pid: 77, title: 'old', minimized: false, standard: true },
            ...(activated && visibleAfterActivate
              ? [
                  {
                    windowId: 43,
                    pid: 77,
                    title: `x — ${marker}`,
                    minimized: false,
                    standard: true,
                  },
                ]
              : []),
          ],
        };
      case 'activateApp':
        activated = true;
        return { ok: true, result: { activated: true, via: 'activate' } };
      case 'captureNewWindow':
        return captureOk
          ? {
              ok: true,
              result: {
                windowId: 42,
                pid: 77,
                title: `x — ${marker}`,
                minimized: false,
                standard: true,
              },
            }
          : { ok: false, error: { code: 'not-found', message: 'no window' } };
      case 'processStartTime':
        return { ok: true, result: { startedAt: shellStartedAt } };
      case 'windowState':
        return { ok: true, result: { state: windowState, reachable: true } };
      case 'isRunning':
        return { ok: true, result: { running: true, pids: [77], apps: [] } };
      case 'focusWindow':
        return { ok: true, result: { activated: true, via: 'activate' } };
      case 'closeWindow':
        if (closeUnreachableOnce && !activated) {
          return { ok: false, error: { code: 'unreachable', message: 'on another desktop' } };
        }
        return { ok: true, result: { outcome: closeOutcome } };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as unknown as WlHelperClient['request'],
};

const kind = createTerminalKind(
  {
    helper,
    readInfo: async () => info,
    readState: async () => session,
    requestRerun: async (m) => {
      reruns.push(m);
    },
    removeFiles: vi.fn(async () => {}),
    descendantsOf: async () => [502, 501],
    signal: (pid, sig) => {
      signals.push([pid, sig]);
      alive.delete(pid);
    },
    isAlive: (pid) => alive.has(pid),
    runDown: async (directory, command) => {
      downs.push([directory, command]);
      return downOk ? { success: true, message: '' } : { success: false, message: 'down failed' };
    },
  },
  { captureTimeoutMs: 50, infoTimeoutMs: 50, graceMs: 30, tiltGraceMs: 30 },
);

const handle = {
  marker,
  pid: 77,
  windowId: 42,
  shellPid: 500,
  shellStartedAt: 1000,
  tty: '/dev/ttys004',
  cwd: String(spec.identity['cwd']),
};

beforeEach(() => {
  windowState = 'alive';
  closeOutcome = 'closed';
  shellStartedAt = 1000;
  session = 'running';
  // Written after any snapshot a test takes — a fresh window's info.
  info = { tty: '/dev/ttys004', shellPid: 500, writtenAt: Date.now() + 60_000 };
  captureOk = true;
  alive = new Set([500, 501, 502]);
  signals.length = 0;
  reruns.length = 0;
  requests.length = 0;
  visibleAfterActivate = true;
  activated = false;
  closeUnreachableOnce = false;
  downs.length = 0;
  downOk = true;
});

describe('terminal kind', () => {
  it('identifies a terminal by directory, commands and occurrence — two identical ones differ', () => {
    expect(markerOf(terminalWindowResource('~/app', ['npm run dev'], 1).identity)).not.toBe(marker);
    expect(marker).toMatch(/^wl-[0-9a-f]{12}$/);
  });

  it('captures the new window carrying its marker, and its shell', async () => {
    const snapshot = await kind.snapshot(spec.identity);
    await expect(kind.capture(spec.identity, snapshot)).resolves.toEqual({
      found: true,
      handle,
      preexisting: false,
    });
    expect(requests.find((r) => r.method === 'captureNewWindow')?.params).toMatchObject({
      before: [1],
      titleContains: marker,
    });
  });

  it('never takes a previous window’s leftover session info for this one’s shell', async () => {
    info = { tty: '/dev/ttys009', shellPid: 600, writtenAt: Date.now() - 60_000 };
    const snapshot = await kind.snapshot(spec.identity);
    await expect(kind.capture(spec.identity, snapshot)).resolves.toMatchObject({
      found: false,
      reason: expect.stringContaining('shell'),
    });
    // Nor after a crash: only info written since the open started counts.
    await expect(kind.reconcileOpening!(spec.identity, Date.now() - 1_000)).resolves.toMatchObject({
      found: false,
    });
  });

  it('still tracks a terminal whose window opened on a desktop it can’t see, by its shell', async () => {
    captureOk = false;
    await expect(kind.capture(spec.identity, await kind.snapshot(spec.identity))).resolves.toEqual({
      found: true,
      handle: { ...handle, windowId: null },
      preexisting: false,
    });
  });

  it('says why when even the shell never reported', async () => {
    captureOk = false;
    info = null;
    await expect(
      kind.capture(spec.identity, await kind.snapshot(spec.identity)),
    ).resolves.toMatchObject({
      found: false,
      reason: expect.stringContaining('shell'),
    });
  });

  it('closing a window never found switches to its desktop, finds it by marker, then closes it', async () => {
    await expect(kind.close({ ...handle, windowId: null })).resolves.toEqual({ outcome: 'closed' });
    expect(requests.map((r) => r.method)).toContain('activateApp');
    expect(requests.at(-1)).toMatchObject({ method: 'closeWindow', params: { windowId: 43 } });
  });

  it('a known window now on another desktop is closed after switching there', async () => {
    closeUnreachableOnce = true;
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(requests.filter((r) => r.method === 'closeWindow')).toHaveLength(2);
  });

  it('still stops the processes, and says so, when the window can’t be found at all', async () => {
    visibleAfterActivate = false;
    await expect(kind.close({ ...handle, windowId: null })).resolves.toEqual({
      outcome: 'failed',
      detail: "stopped its processes, but couldn't find its window to close it",
    });
    expect(signals.map(([pid]) => pid)).toContain(500);
  });

  it('is gone once the window or the shell is — a reused pid is a different shell', async () => {
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'alive' });
    shellStartedAt = 9999;
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'gone' });
    shellStartedAt = 1000;
    windowState = 'gone';
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'gone' });
  });

  it('lets go of a terminal the user took over (drifted), never closing it', async () => {
    session = 'shell';
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'drifted' });
    await expect(kind.close(handle)).resolves.toMatchObject({ outcome: 'kept-running' });
    expect(signals).toEqual([]);
  });

  it('re-runs finished commands in place, and only then', async () => {
    await expect(kind.revive!(handle)).resolves.toBe(false);
    session = 'done';
    await expect(kind.revive!(handle)).resolves.toBe(true);
    expect(reruns).toEqual([marker]);
  });

  it('brings its window forward — finding it by marker first when it opened elsewhere', async () => {
    await expect(kind.focus!(handle)).resolves.toBeNull();
    expect(requests.at(-1)).toMatchObject({ method: 'focusWindow', params: { windowId: 42 } });
    await expect(kind.focus!({ ...handle, windowId: null })).resolves.toBeNull();
    expect(requests.at(-1)).toMatchObject({ method: 'focusWindow', params: { windowId: 43 } });
    expect(signals).toEqual([]);
  });

  it('stops the processes first (deepest first, then the shell), then closes the window', async () => {
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(signals).toEqual([
      [502, 'SIGHUP'],
      [501, 'SIGHUP'],
      [500, 'SIGHUP'],
    ]);
    expect(requests.at(-1)).toMatchObject({ method: 'closeWindow', params: { windowId: 42 } });
  });

  it('kills leftovers that ignore the hangup', async () => {
    // 501 survives SIGHUP.
    const stubborn = createTerminalKind(
      {
        helper,
        readInfo: async () => info,
        readState: async () => session,
        requestRerun: async () => {},
        removeFiles: async () => {},
        descendantsOf: async () => [501],
        signal: (pid, sig) => {
          signals.push([pid, sig]);
          if (sig === 'SIGKILL' || pid !== 501) alive.delete(pid);
        },
        isAlive: (pid) => alive.has(pid),
        runDown: async () => ({ success: true, message: '' }),
      },
      { graceMs: 30 },
    );
    await stubborn.close(handle);
    expect(signals).toContainEqual([501, 'SIGKILL']);
  });

  it('never confirms Terminal’s own dialog — reports it as refused', async () => {
    closeOutcome = 'blocked';
    await expect(kind.close(handle)).resolves.toEqual({
      outcome: 'refused',
      detail: 'Terminal is asking before closing it',
    });
  });

  describe('Tilt', () => {
    const tilt = { downCommand: '', stopOnClose: true };

    it('records how to stop it when its step is a Tilt one', async () => {
      const tiltSpec = terminalWindowResource('~/app', ['tilt up'], 0, tilt);
      const captured = await kind.capture(
        tiltSpec.identity,
        await kind.snapshot(tiltSpec.identity),
        tiltSpec.options,
      );
      expect(captured).toMatchObject({ found: true, handle: { tilt } });
    });

    it('Ctrl+C first, then the Down command in its directory, then closes the window', async () => {
      await expect(kind.close({ ...handle, tilt })).resolves.toEqual({ outcome: 'closed' });
      expect(signals.slice(0, 2)).toEqual([
        [502, 'SIGINT'],
        [501, 'SIGINT'],
      ]);
      expect(downs).toEqual([[handle.cwd, 'tilt down']]);
      expect(requests.at(-1)).toMatchObject({ method: 'closeWindow' });
    });

    it('leaves Tilt running when stop on close is off', async () => {
      await expect(
        kind.close({ ...handle, tilt: { downCommand: '', stopOnClose: false } }),
      ).resolves.toEqual({
        outcome: 'kept-running',
        detail: 'stop on close is off for this step',
      });
      expect(signals).toEqual([]);
      expect(downs).toEqual([]);
    });

    it('keeps the window open and reports a failed Down command', async () => {
      downOk = false;
      await expect(kind.close({ ...handle, tilt })).resolves.toEqual({
        outcome: 'failed',
        detail: 'down failed',
      });
      expect(requests.some((r) => r.method === 'closeWindow')).toBe(false);
    });
  });
});
