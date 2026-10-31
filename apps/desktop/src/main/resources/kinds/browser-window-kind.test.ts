import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WlHelperClient } from '../../platform/macos/wl-helper-client';
import type {
  BrowserAdapter,
  BrowserResult,
  BrowserWindow,
} from '../../platform/macos/chromium-browser';
import { BrowserSessions } from '../browser-sessions';
import { identityKeyFor } from '../kind-registry';
import { createBrowserWindowKind, type BrowserWindowHandle } from './browser-window-kind';
import { browserWindowResource } from './browser-window-spec';

vi.mock('electron-store', () => ({ default: class {} }));

// A simulated Chrome: every window as both Accessibility (window id,
// title, frame) and scripting (script id, name, tabs) see it.
interface SimWindow {
  windowId: number;
  scriptId: string;
  name: string;
  urls: string[];
  active: number;
  frame: { x: number; y: number; width: number; height: number };
  incognito?: boolean;
}

const MAXIMIZED = { x: 0, y: 33, width: 1470, height: 923 };
const spec = browserWindowResource({
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  profile: 'Default',
  profileLabel: 'Stas',
  stepId: 'step-1',
  seedUrls: ['https://a.com', 'https://b.com'],
  workspaceName: 'Client X',
});
const key = identityKeyFor(spec);

let windows: SimWindow[];
let running: boolean;
let listFails: boolean;
let scripting: 'ok' | 'denied';
let goneIds: Set<number>;
let closeOutcome: 'closed' | 'still-open';
let closed: number[];
let focused: number[];
let sessions: BrowserSessions;
const watched: string[] = [];

// Chrome's own title formats: "<name or tab> - Google Chrome - <profile>",
// and "<…> - Google Chrome (Incognito)" for incognito windows.
const titleOf = (w: SimWindow): string =>
  `${w.name || w.urls[w.active - 1]!.toUpperCase()} - Google Chrome${w.incognito ? ' (Incognito)' : ' - Stas'}`;

const helper = {
  request: (async (method: string, params: Record<string, unknown>) => {
    const ax = (w: SimWindow) => ({
      windowId: w.windowId,
      pid: 77,
      title: titleOf(w),
      minimized: false,
      standard: true,
      frame: w.frame,
    });
    switch (method) {
      case 'listWindows':
        if (listFails) return { ok: false, error: { code: 'ax-timeout', message: 'no answer' } };
        return { ok: true, result: running ? windows.map(ax) : [] };
      case 'captureNewWindow': {
        const fresh = windows.filter((w) => !(params['before'] as number[]).includes(w.windowId));
        return fresh.length === 1
          ? { ok: true, result: ax(fresh[0]!) }
          : { ok: false, error: { code: 'not-found', message: 'no single new window' } };
      }
      case 'windowState':
        return {
          ok: true,
          result:
            goneIds.has(params['windowId'] as number) || !running
              ? { state: 'gone', reachable: false }
              : { state: 'alive', reachable: true },
        };
      case 'isRunning':
        return { ok: true, result: { running, pids: running ? [77] : [], apps: [] } };
      case 'focusWindow':
        focused.push(params['windowId'] as number);
        return { ok: true, result: { activated: true, via: 'activate' } };
      case 'closeWindow':
        closed.push(params['windowId'] as number);
        if (closeOutcome === 'closed') {
          windows = windows.filter((w) => w.windowId !== params['windowId']);
        }
        return { ok: true, result: { outcome: closeOutcome } };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as unknown as WlHelperClient['request'],
};

const adapter: BrowserAdapter = {
  appName: 'Google Chrome',
  async readWindows(): Promise<BrowserResult<BrowserWindow[]>> {
    if (!running) {
      return { ok: false, code: 'not-running', message: "Google Chrome isn't running." };
    }
    if (scripting === 'denied') {
      return { ok: false, code: 'denied', message: 'not allowed to control Google Chrome.' };
    }
    return {
      ok: true,
      value: windows.map((w) => ({
        scriptId: w.scriptId,
        name: w.name,
        frame: { ...w.frame },
        incognito: w.incognito ?? false,
        activeTabIndex: w.active,
        tabs: w.incognito ? [] : w.urls.map((url) => ({ title: url.toUpperCase(), url })),
      })),
    };
  },
  async nameWindow(scriptId, name) {
    const window = windows.find((w) => w.scriptId === scriptId);
    if (window) window.name = name;
    return { ok: true, value: undefined };
  },
  async setActiveTab(scriptId, index) {
    const window = windows.find((w) => w.scriptId === scriptId);
    if (window) window.active = index;
    return { ok: true, value: undefined };
  },
};

const kind = createBrowserWindowKind(
  {
    helper,
    adapterFor: () => adapter,
    sessions: () => sessions,
    watch: (bundleId) => watched.push(bundleId),
  },
  { captureTimeoutMs: 100, confirmTimeoutMs: 100 },
);

const userWindow = (overrides: Partial<SimWindow> = {}): SimWindow => ({
  windowId: 1,
  scriptId: '100',
  name: '',
  urls: ['https://mine.com'],
  active: 1,
  frame: MAXIMIZED,
  ...overrides,
});
const stepWindow = (overrides: Partial<SimWindow> = {}): SimWindow => ({
  windowId: 42,
  scriptId: '200',
  name: '',
  urls: ['https://a.com/', 'https://b.com'],
  active: 1,
  frame: MAXIMIZED,
  ...overrides,
});

const handle: BrowserWindowHandle = {
  pid: 77,
  windowId: 42,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  name: 'Client X',
  identityKey: key,
};

beforeEach(() => {
  windows = [userWindow()];
  running = true;
  listFails = false;
  scripting = 'ok';
  goneIds = new Set();
  closeOutcome = 'closed';
  closed = [];
  focused = [];
  watched.length = 0;
  sessions = new BrowserSessions({ read: () => undefined, write: () => {} });
  vi.restoreAllMocks();
});

/** Restore: snapshot, the step's window (or `opened`) appears, capture. */
async function restore(...opened: SimWindow[]): ReturnType<typeof kind.capture> {
  const snapshot = await kind.snapshot(spec.identity, spec.options);
  windows.push(...(opened.length > 0 ? opened : [stepWindow()]));
  return kind.capture(spec.identity, snapshot, spec.options);
}

describe('capturing the step’s window', () => {
  it('names the new window after its workspace, and starts saving its tabs', async () => {
    await expect(restore()).resolves.toEqual({ found: true, handle, preexisting: false });
    expect(windows.map((w) => w.name)).toEqual(['', 'Client X']);
    expect(watched).toEqual(['com.google.Chrome']);
  });

  it('accepts the loaded tab being redirected on the same site (google.com → www.google.com/)', async () => {
    await expect(
      restore(stepWindow({ urls: ['https://www.a.com/welcome', 'https://b.com'] })),
    ).resolves.toMatchObject({ found: true });
  });

  it('but not to another site — or the tabs not yet loaded differing at all', async () => {
    await expect(
      restore(stepWindow({ urls: ['https://elsewhere.com/', 'https://b.com'] })),
    ).resolves.toMatchObject({ found: false });
    windows = [userWindow()];
    await expect(
      restore(stepWindow({ urls: ['https://a.com/', 'https://b.com/'] })),
    ).resolves.toMatchObject({ found: false });
  });

  it('keeps names unique — the name is how it’s found again', async () => {
    windows[0]!.name = 'Client X';
    await expect(restore()).resolves.toMatchObject({ handle: { name: 'Client X (2)' } });
  });

  it('lands on the tab the user was on last time', async () => {
    sessions.save(key, {
      tabs: [
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      activeTabIndex: 2,
    });
    await restore();
    expect(windows[1]!.active).toBe(2);
  });

  it('works on a cold start — with Chrome not running, nothing was open before', async () => {
    running = false;
    windows = [];
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    running = true;
    windows = [stepWindow()];
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      found: true,
    });
  });

  it('on a cold start that also restored the user’s window, names only its own', async () => {
    running = false;
    windows = [];
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    running = true;
    windows = [stepWindow()];
    const capturing = kind.capture(spec.identity, snapshot, spec.options);
    windows.push(userWindow({ windowId: 7, scriptId: '300' }));
    await expect(capturing).resolves.toMatchObject({ found: true, handle: { windowId: 42 } });
    expect(windows.find((w) => w.scriptId === '300')!.name).toBe('');
  });

  it('when Chrome reopened the workspace’s old window by itself, keeps one — never two', async () => {
    running = false;
    windows = [];
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    running = true;
    // Chrome restores its last session: the user's window and the
    // workspace's own named window — then the step's new one appears.
    windows = [
      userWindow(),
      stepWindow({ windowId: 50, scriptId: '500', name: 'Client X' }),
      stepWindow(),
    ];
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      found: true,
      handle: { windowId: 42, name: 'Client X' },
    });
    expect(closed).toEqual([50]);
  });

  it('never takes the user’s window for the new one — it must hold exactly the tabs opened', async () => {
    await expect(restore(userWindow({ windowId: 7, scriptId: '300' }))).resolves.toMatchObject({
      found: false,
    });
    expect(windows.every((w) => w.name === '')).toBe(true);
  });

  it('never captures when the windows open before couldn’t be listed', async () => {
    listFails = true;
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    listFails = false;
    windows.push(stepWindow());
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      found: false,
    });
  });

  it('isn’t tracked without permission to control Chrome — it can’t be told apart or saved', async () => {
    scripting = 'denied';
    await expect(restore()).resolves.toMatchObject({ found: false });
  });

  it('never tracks a window whose position doesn’t match what Chrome reports for it', async () => {
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    windows.push(stepWindow());
    const realRead = adapter.readWindows.bind(adapter);
    vi.spyOn(adapter, 'readWindows').mockImplementation(async () => {
      const read = await realRead();
      if (read.ok) read.value[1]!.frame = { x: 500, y: 500, width: 100, height: 100 };
      return read;
    });
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      found: false,
    });
  });

  it('undoes the name, and doesn’t track, when the name can’t be confirmed on the window caught', async () => {
    const snapshot = await kind.snapshot(spec.identity, spec.options);
    windows.push(stepWindow());
    const naming = vi.spyOn(adapter, 'nameWindow').mockImplementation(async (scriptId, name) => {
      // Another window shows up carrying the same name: ambiguous.
      if (name !== '' && !windows.some((w) => w.scriptId === '900')) {
        windows.push(userWindow({ windowId: 9, scriptId: '900', name }));
      }
      const window = windows.find((w) => w.scriptId === scriptId);
      if (window) window.name = name;
      return { ok: true, value: undefined };
    });
    await expect(kind.capture(spec.identity, snapshot, spec.options)).resolves.toMatchObject({
      found: false,
    });
    expect(naming).toHaveBeenLastCalledWith('200', '');
  });

  it('never adopts a window the user opened', async () => {
    await expect(kind.findLive(spec.identity)).resolves.toBeNull();
  });
});

describe('a named window’s title', () => {
  it('starts with its name — Chrome inserts the active tab’s state after it', async () => {
    const { isNamedTitle } = await import('./browser-window-kind');
    expect(isNamedTitle('Chrome - Google Chrome - Stas', 'Chrome', 'Google Chrome')).toBe(true);
    expect(isNamedTitle('Chrome - Google Chrome', 'Chrome', 'Google Chrome')).toBe(true);
    expect(
      isNamedTitle('VSC Test - Pinned - Google Chrome - Stas', 'VSC Test', 'Google Chrome'),
    ).toBe(true);
    expect(
      isNamedTitle('Chrome - Audio playing - Google Chrome - Stas', 'Chrome', 'Google Chrome'),
    ).toBe(true);
    expect(isNamedTitle('Chromecast - Google Chrome - Stas', 'Chrome', 'Google Chrome')).toBe(
      false,
    );
    expect(isNamedTitle('Chrome - Safari', 'Chrome', 'Google Chrome')).toBe(false);
  });
});

describe('closing while a tab plays audio', () => {
  it('still closes its own window', async () => {
    windows.push(stepWindow({ name: 'Client X', urls: ['https://a.com'] }));
    const realRequest = helper.request;
    vi.spyOn(helper, 'request').mockImplementation((async (method: string, params: never) => {
      const response = (await realRequest(method as 'listWindows', params)) as {
        ok: boolean;
        result: { title: string }[];
      };
      if (method === 'listWindows' && response.ok) {
        for (const w of response.result)
          w.title = w.title.replace(' - Google', ' - Audio playing - Google');
      }
      return response;
    }) as never);
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
  });
});

describe('finding it again', () => {
  it('after Chrome restarted, by its name — at its new ids', async () => {
    goneIds.add(42);
    windows.push(stepWindow({ windowId: 99, scriptId: '999', name: 'Client X' }));
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({
      state: 'alive',
      handle: { ...handle, windowId: 99 },
    });
  });

  it('is gone once Chrome quit — the workspace isn’t active any more', async () => {
    running = false;
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'gone' });
  });

  it('never mistakes a window whose tab just happens to be titled like the workspace', async () => {
    goneIds.add(42);
    windows.push(userWindow({ windowId: 8, scriptId: '800', urls: ['client x'] }));
    await expect(kind.check(handle, spec.identity)).resolves.toEqual({ state: 'gone' });
  });
});

describe('bringing it forward', () => {
  it('raises its own window — found again by name if Chrome restarted', async () => {
    goneIds.add(42);
    windows.push(stepWindow({ windowId: 99, scriptId: '999', name: 'Client X' }));
    await expect(kind.focus!(handle)).resolves.toBeNull();
    expect(focused).toEqual([99]);
  });

  it('touches nothing when its window is gone', async () => {
    goneIds.add(42);
    await expect(kind.focus!(handle)).resolves.toBe('its window is gone');
    expect(focused).toEqual([]);
  });
});

describe('closing it', () => {
  beforeEach(() => {
    windows.push(
      stepWindow({ name: 'Client X', urls: ['https://a.com', 'https://new.com'], active: 2 }),
    );
  });

  it('saves its tabs, then closes it — whatever it holds is the workspace’s session', async () => {
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(closed).toEqual([42]);
    expect(sessions.get(key)).toMatchObject({
      tabs: [
        { title: 'HTTPS://A.COM', url: 'https://a.com' },
        { title: 'HTTPS://NEW.COM', url: 'https://new.com' },
      ],
      activeTabIndex: 2,
    });
  });

  it('closes and saves nothing when two windows carry its name', async () => {
    windows.push(
      userWindow({
        windowId: 5,
        scriptId: '500',
        name: 'Client X',
        frame: { x: 9, y: 9, width: 900, height: 900 },
      }),
    );
    await expect(kind.close(handle)).resolves.toMatchObject({
      outcome: 'refused',
      detail: expect.stringContaining('2 Google Chrome windows are named "Client X"'),
    });
    expect(closed).toEqual([]);
    expect(sessions.get(key)).toBeUndefined();
  });

  it('ignores an incognito window with the same name — never reads or saves it', async () => {
    windows.push(userWindow({ windowId: 5, scriptId: '500', name: 'Client X', incognito: true }));
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'closed' });
    expect(closed).toEqual([42]);
  });

  it('closes nothing when the window carrying its name isn’t the one it opened', async () => {
    windows = [userWindow(), stepWindow({ windowId: 43, scriptId: '201', name: 'Client X' })];
    await expect(kind.close(handle)).resolves.toMatchObject({ outcome: 'refused' });
    expect(closed).toEqual([]);
  });

  it('never closes a window whose tabs it can’t save', async () => {
    scripting = 'denied';
    await expect(kind.close(handle)).resolves.toMatchObject({
      outcome: 'needs-permission',
      detail: expect.stringContaining('left open'),
    });
    expect(closed).toEqual([]);
  });

  it('names the page that blocks the close, and keeps the window', async () => {
    closeOutcome = 'still-open';
    await expect(kind.close(handle)).resolves.toEqual({
      outcome: 'refused',
      detail: expect.stringContaining('"HTTPS://NEW.COM" is asking before it closes'),
    });
  });

  it('has nothing to close once Chrome quit', async () => {
    running = false;
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'already-gone' });
    expect(closed).toEqual([]);
  });

  it('a window closed by hand is simply gone — its tabs were saved as they changed', async () => {
    windows = [userWindow()];
    goneIds.add(42);
    await expect(kind.close(handle)).resolves.toEqual({ outcome: 'already-gone' });
    expect(closed).toEqual([]);
  });
});
