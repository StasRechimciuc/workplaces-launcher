import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelperEvent, WlHelperClient } from '../../platform/macos/wl-helper-client';
import type { BrowserAdapter, BrowserWindow } from '../../platform/macos/chromium-browser';
import { BrowserSessions } from '../browser-sessions';
import { addResource } from '../ledger';
import { ResourceLedgerStore } from '../ledger-store';
import { BrowserWatch } from './browser-watch';
import type { BrowserWindowHandle } from './browser-window-kind';
import { BROWSER_WINDOW_KIND } from './browser-window-spec';

vi.mock('electron-store', () => ({ default: class {} }));

const handle: BrowserWindowHandle = {
  pid: 77,
  windowId: 42,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  name: 'Client X',
  identityKey: 'key-1',
};

let listener: ((event: HelperEvent) => void) | null;
let titles: string[];
let reads: number;
let scripted: BrowserWindow[];
const watchCalls: string[] = [];
const unwatchCalls: string[] = [];
let store: ResourceLedgerStore;
let sessions: BrowserSessions;

const helper = {
  request: (async (method: string) => {
    if (method !== 'windowTabs') throw new Error(`unexpected ${method}`);
    return { ok: true, result: { hasTabStrip: true, titles } };
  }) as unknown as WlHelperClient['request'],
  watch: (async (bundleId: string) => {
    watchCalls.push(bundleId);
    return { ok: true, result: { watching: true, pids: [77] } };
  }) as WlHelperClient['watch'],
  unwatch: (async (bundleId: string) => {
    unwatchCalls.push(bundleId);
  }) as WlHelperClient['unwatch'],
  onEvent: ((l: (event: HelperEvent) => void) => {
    listener = l;
    return () => {};
  }) as WlHelperClient['onEvent'],
};

const adapter = {
  appName: 'Google Chrome',
  readWindows: async () => {
    reads++;
    return { ok: true as const, value: scripted };
  },
} as unknown as BrowserAdapter;

function trackWindow(): void {
  store.update(
    (l) =>
      addResource(l, {
        kind: BROWSER_WINDOW_KIND,
        identityKey: 'id',
        label: 'Chrome window',
        owner: { workspaceId: 'A', stepId: 's' },
        createdByApp: true,
        handle,
        state: 'open',
      }).ledger,
  );
}

let watch: BrowserWatch;

beforeEach(() => {
  listener = null;
  titles = ['A', 'B'];
  reads = 0;
  scripted = [
    {
      scriptId: '1',
      name: 'Client X',
      frame: { x: 0, y: 0, width: 1, height: 1 },
      incognito: false,
      activeTabIndex: 1,
      tabs: [{ title: 'A', url: 'https://a.com' }],
    },
  ];
  watchCalls.length = 0;
  unwatchCalls.length = 0;
  let stored: unknown;
  store = new ResourceLedgerStore({ read: () => stored, write: (l) => (stored = l) });
  store.load('boot');
  sessions = new BrowserSessions({ read: () => undefined, write: () => {} });
  watch = new BrowserWatch({
    helper,
    adapterFor: () => adapter,
    sessions: () => sessions,
    ledger: () => store,
    debounceMs: 10,
  });
});

describe('saving browser tabs as they change', () => {
  it('watches a browser once, and saves its window’s tabs after a change settles', async () => {
    trackWindow();
    watch.watch('com.google.Chrome', 'Google Chrome');
    watch.watch('com.google.Chrome', 'Google Chrome');
    expect(watchCalls).toEqual(['com.google.Chrome']);
    listener!({ event: 'app-changed', bundleId: 'com.google.Chrome', pid: 77 });
    await vi.waitFor(() =>
      expect(sessions.get('key-1')?.tabs).toEqual([{ title: 'A', url: 'https://a.com' }]),
    );
  });

  it('only asks the browser for URLs when the tab titles actually changed', async () => {
    trackWindow();
    watch.watch('com.google.Chrome', 'Google Chrome');
    await watch.save('com.google.Chrome');
    await watch.save('com.google.Chrome');
    expect(reads).toBe(1);
    titles = ['A', 'B', 'C'];
    await watch.save('com.google.Chrome');
    expect(reads).toBe(2);
  });

  it('tries again on the next change when a save couldn’t read the browser', async () => {
    trackWindow();
    watch.watch('com.google.Chrome', 'Google Chrome');
    const realRead = adapter.readWindows;
    adapter.readWindows = async () => {
      reads++;
      return { ok: false as const, code: 'failed' as const, message: 'busy' };
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await watch.save('com.google.Chrome');
    adapter.readWindows = realRead;
    errors.mockRestore();
    await watch.save('com.google.Chrome');
    expect(sessions.get('key-1')).toBeDefined();
  });

  it('saves nothing when two windows carry the name', async () => {
    trackWindow();
    scripted = [...scripted, { ...scripted[0]!, scriptId: '2' }];
    watch.watch('com.google.Chrome', 'Google Chrome');
    await watch.save('com.google.Chrome');
    expect(sessions.get('key-1')).toBeUndefined();
  });

  it('stops watching once none of its windows is tracked any more', async () => {
    watch.watch('com.google.Chrome', 'Google Chrome');
    await watch.save('com.google.Chrome');
    expect(unwatchCalls).toEqual(['com.google.Chrome']);
  });

  it('still saves while a page keeps changing — a ticking title never holds saves back for long', async () => {
    trackWindow();
    watch = new BrowserWatch({
      helper,
      adapterFor: () => adapter,
      sessions: () => sessions,
      ledger: () => store,
      debounceMs: 40,
      maxWaitMs: 100,
    });
    watch.watch('com.google.Chrome', 'Google Chrome');
    const ticking = setInterval(
      () => listener!({ event: 'app-changed', bundleId: 'com.google.Chrome', pid: 77 }),
      10,
    );
    try {
      await vi.waitFor(() => expect(reads).toBeGreaterThan(0), { timeout: 1000 });
    } finally {
      clearInterval(ticking);
      // Lets its last scheduled save run out before the next test.
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  it('ignores browsers it isn’t watching', async () => {
    trackWindow();
    listener!({ event: 'app-changed', bundleId: 'com.brave.Browser', pid: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(reads).toBe(0);
  });
});
