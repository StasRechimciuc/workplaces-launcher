import type { WlHelperClient } from '../../platform/macos/wl-helper-client';
import type { BrowserAdapter } from '../../platform/macos/chromium-browser';
import type { BrowserSessions } from '../browser-sessions';
import type { ResourceLedgerStore } from '../ledger-store';
import { parseBrowserWindowHandle, type BrowserWindowHandle } from './browser-window-kind';
import { BROWSER_WINDOW_KIND } from './browser-window-spec';

/**
 * Saves the tabs of the browser windows this app opened whenever they
 * change (WCs/WC__window-tracking.md, Phase 4) — so a window the user
 * closes by hand loses nothing. Event-driven, never polled: the helper
 * pushes a signal when a window or tab changes (Watcher.swift); after
 * a short quiet period the tab titles — cheap, through Accessibility —
 * tell whether anything changed, and only then are the URLs read
 * through the browser's scripting interface and saved.
 *
 * A browser stays watched while any of its windows is tracked, and is
 * dropped once none is.
 */

export interface BrowserWatchDeps {
  helper: Pick<WlHelperClient, 'request' | 'watch' | 'unwatch' | 'onEvent'>;
  adapterFor: (appName: string) => BrowserAdapter;
  sessions: () => BrowserSessions | null;
  ledger: () => ResourceLedgerStore | null;
  /**
   * Quiet time before saving — short: a window the user closes right
   * after changing a tab must already have that change saved (with 2s,
   * closing a tab and then the window lost the tab close).
   */
  debounceMs?: number;
  /** The longest changes can keep a save waiting (a ticking title never settles). */
  maxWaitMs?: number;
}

export class BrowserWatch {
  /** Watched browsers: bundle id → the name its scripting interface answers to. */
  private readonly appNames = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** When the oldest unsaved change per browser arrived. */
  private readonly pendingSince = new Map<string, number>();
  /** What each window (resource id) looked like when its tabs were last saved. */
  private readonly lastSaved = new Map<string, string>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly deps: BrowserWatchDeps) {
    this.debounceMs = deps.debounceMs ?? 300;
    this.maxWaitMs = deps.maxWaitMs ?? 2_000;
    deps.helper.onEvent((event) => {
      if (event.event === 'app-changed' && this.appNames.has(event.bundleId)) {
        this.schedule(event.bundleId);
      }
    });
  }

  watch(bundleId: string, appName: string): void {
    if (this.appNames.has(bundleId)) return;
    this.appNames.set(bundleId, appName);
    void this.deps.helper.watch(bundleId).then((response) => {
      if (!response.ok) {
        console.error(`Can't save ${appName}'s tabs as they change: ${response.error.message}`);
      }
    });
  }

  /** Saves now (tests, and anything that can't wait for the quiet period). */
  async save(bundleId: string): Promise<void> {
    const appName = this.appNames.get(bundleId);
    const ledger = this.deps.ledger();
    if (!appName || !ledger) return;
    const windows = ledger
      .get()
      .resources.filter((r) => r.kind === BROWSER_WINDOW_KIND && r.owners.length > 0)
      .map((r) => ({ id: r.id, handle: r.handle ? parseBrowserWindowHandle(r.handle) : null }))
      .filter(
        (w): w is { id: string; handle: BrowserWindowHandle } =>
          w.handle !== null && w.handle.bundleId === bundleId,
      );
    const tracked = new Set(windows.map((w) => w.id));
    for (const id of this.lastSaved.keys()) if (!tracked.has(id)) this.lastSaved.delete(id);
    if (windows.length === 0) {
      this.stop(bundleId);
      return;
    }
    const changed = await this.changedWindows(windows);
    if (changed.length === 0) return;

    const read = await this.deps.adapterFor(appName).readWindows();
    if (!read.ok) {
      if (read.code !== 'not-running') {
        console.error(`Couldn't save ${appName}'s tabs: ${read.message}`);
      }
      return;
    }
    for (const { id, handle, look } of changed) {
      // Only ever from the one (non-incognito) window carrying its name.
      const named = read.value.filter((w) => !w.incognito && w.name === handle.name);
      if (named.length !== 1) continue;
      this.deps.sessions()?.save(handle.identityKey, {
        tabs: named[0]!.tabs,
        activeTabIndex: named[0]!.activeTabIndex,
      });
      if (look !== null) this.lastSaved.set(id, look);
    }
  }

  /**
   * Saves once changes have been quiet for `debounceMs` — but never
   * later than `maxWaitMs` after the first unsaved change: a page that
   * keeps changing (a ticking timer in its title) must not hold every
   * save back for as long as it's open.
   */
  private schedule(bundleId: string): void {
    const now = Date.now();
    const since = this.pendingSince.get(bundleId) ?? now;
    this.pendingSince.set(bundleId, since);
    const delay = Math.max(0, Math.min(this.debounceMs, since + this.maxWaitMs - now));
    clearTimeout(this.timers.get(bundleId));
    this.timers.set(
      bundleId,
      setTimeout(() => {
        this.timers.delete(bundleId);
        this.pendingSince.delete(bundleId);
        this.save(bundleId).catch((err: unknown) => {
          console.error(
            `Saving browser tabs failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, delay),
    );
  }

  /**
   * The windows whose tabs may have changed since they were last saved:
   * tab titles, the selected tab, and the page on screen (navigating
   * within a tab can keep its title) — all cheap, through Accessibility.
   * A window that can't be read by id (the browser restarted) counts as
   * changed: its tabs are found by name instead.
   */
  private async changedWindows(
    windows: { id: string; handle: BrowserWindowHandle }[],
  ): Promise<{ id: string; handle: BrowserWindowHandle; look: string | null }[]> {
    const changed: { id: string; handle: BrowserWindowHandle; look: string | null }[] = [];
    for (const { id, handle } of windows) {
      const tabs = await this.deps.helper.request('windowTabs', {
        pid: handle.pid,
        windowId: handle.windowId,
      });
      if (!tabs.ok) {
        changed.push({ id, handle, look: null });
        continue;
      }
      const look = JSON.stringify([
        tabs.result.titles,
        tabs.result.selectedIndex ?? null,
        tabs.result.activeUrl ?? null,
      ]);
      if (this.lastSaved.get(id) !== look) changed.push({ id, handle, look });
    }
    return changed;
  }

  private stop(bundleId: string): void {
    this.appNames.delete(bundleId);
    clearTimeout(this.timers.get(bundleId));
    this.timers.delete(bundleId);
    this.pendingSince.delete(bundleId);
    void this.deps.helper.unwatch(bundleId);
  }
}
