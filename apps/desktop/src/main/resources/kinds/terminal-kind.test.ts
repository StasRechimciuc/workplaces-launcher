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
let info: { tty: string; shellPid: number } | null = { tty: '/dev/ttys004', shellPid: 500 };
let captureOk = true;
let alive = new Set([500, 501, 502]);
const signals: [number, string][] = [];
const reruns: string[] = [];
const requests: { method: string; params: Record<string, unknown> }[] = [];

const helper = {
  request: (async (method: string, params: Record<string, unknown>) => {
    requests.push({ method, params });
    switch (method) {
      case 'listWindows':
        return {
          ok: true,
          result: [{ windowId: 1, pid: 77, title: 'old', minimized: false, standard: true }],
        };
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
      case 'closeWindow':
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
  },
  { captureTimeoutMs: 50, graceMs: 30 },
);

const handle = {
  marker,
  pid: 77,
  windowId: 42,
  shellPid: 500,
  shellStartedAt: 1000,
  tty: '/dev/ttys004',
};

beforeEach(() => {
  windowState = 'alive';
  closeOutcome = 'closed';
  shellStartedAt = 1000;
  session = 'running';
  info = { tty: '/dev/ttys004', shellPid: 500 };
  captureOk = true;
  alive = new Set([500, 501, 502]);
  signals.length = 0;
  reruns.length = 0;
  requests.length = 0;
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

  it('reports why nothing was captured (e.g. Terminal opens tabs, not windows)', async () => {
    captureOk = false;
    await expect(kind.capture(spec.identity, [])).resolves.toMatchObject({
      found: false,
      reason: expect.stringContaining('no new Terminal window'),
    });
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
});
