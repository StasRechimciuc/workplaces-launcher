import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { RestoreProgressEvent } from '@workspace-launcher/shared';
import type { startRestoreFocusSession as StartRestoreFocusSession } from './restore-focus';

function makeMockWin(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  };
}

function asWin(win: ReturnType<typeof makeMockWin>): BrowserWindow {
  return win as unknown as BrowserWindow;
}

function runningEvent(overrides: Partial<RestoreProgressEvent> = {}): RestoreProgressEvent {
  return { workspaceId: 'ws-1', stepIndex: 0, total: 1, status: 'running', ...overrides };
}

// activeSessions is deliberate module-level state (see restore-focus.ts's
// own doc comment — it's a shared resource across overlapping restores),
// so it must not leak between otherwise-unrelated tests. Re-imported
// fresh per test via vi.resetModules(), same pattern orchestrator.test.ts
// already uses for the tool registry's own module-level state.
describe('startRestoreFocusSession', () => {
  let startRestoreFocusSession: typeof StartRestoreFocusSession;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    ({ startRestoreFocusSession } = await import('./restore-focus'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing for a null window', () => {
    const session = startRestoreFocusSession(null);
    expect(() => session.reassert(runningEvent())).not.toThrow();
    expect(() => session.end()).not.toThrow();
  });

  it('does nothing for a minimized window', () => {
    const win = makeMockWin({ isMinimized: vi.fn(() => true) });
    startRestoreFocusSession(asWin(win));
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('does nothing for an already-destroyed window', () => {
    const win = makeMockWin({ isDestroyed: vi.fn(() => true) });
    startRestoreFocusSession(asWin(win));
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it('pins the window on top and moves it to front on begin', () => {
    const win = makeMockWin();
    startRestoreFocusSession(asWin(win));
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(win.moveTop).toHaveBeenCalledTimes(1);
  });

  it('reassert only acts on a "running" event, not "success"/"failure"', () => {
    const win = makeMockWin();
    const session = startRestoreFocusSession(asWin(win));
    win.moveTop.mockClear();

    session.reassert(runningEvent({ status: 'success' }));
    expect(win.moveTop).not.toHaveBeenCalled();

    session.reassert(runningEvent({ status: 'running' }));
    expect(win.moveTop).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it('clears always-on-top once the session ends', () => {
    const win = makeMockWin();
    const session = startRestoreFocusSession(asWin(win));
    session.end();
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('end() is idempotent — calling it twice only clears once', () => {
    const win = makeMockWin();
    const session = startRestoreFocusSession(asWin(win));
    session.end();
    session.end();
    expect(win.setAlwaysOnTop.mock.calls.filter((call) => call[0] === false)).toHaveLength(1);
  });

  it('reassert/end are no-ops after end() has already fired', () => {
    const win = makeMockWin();
    const session = startRestoreFocusSession(asWin(win));
    session.end();
    win.moveTop.mockClear();
    session.reassert(runningEvent());
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it('two overlapping sessions on the same window: setAlwaysOnTop(false) only fires once BOTH have ended', () => {
    const win = makeMockWin();
    const sessionA = startRestoreFocusSession(asWin(win));
    const sessionB = startRestoreFocusSession(asWin(win));

    sessionA.end();
    // Session B is still active — must not have been turned off yet.
    expect(win.setAlwaysOnTop).not.toHaveBeenCalledWith(false);

    sessionB.end();
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('force-clears always-on-top after the hard cap even if end() is never called', () => {
    const win = makeMockWin();
    startRestoreFocusSession(asWin(win));
    expect(win.setAlwaysOnTop).not.toHaveBeenCalledWith(false);

    vi.advanceTimersByTime(60_000);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('a real end() after the hard cap already fired does not double-clear or throw', () => {
    const win = makeMockWin();
    const session = startRestoreFocusSession(asWin(win));
    vi.advanceTimersByTime(60_000);
    win.setAlwaysOnTop.mockClear();

    expect(() => session.end()).not.toThrow();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
