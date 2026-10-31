import { z } from 'zod';
import type { HelperWindow, WlHelperClient } from '../../platform/macos/wl-helper-client';
import type {
  BrowserAdapter,
  BrowserResult,
  BrowserWindow,
} from '../../platform/macos/chromium-browser';
import type { BrowserSessions } from '../browser-sessions';
import { identityKeyFor } from '../kind-registry';
import type {
  CaptureResult,
  CloseOutcome,
  HandleState,
  ResourceHandle,
  ResourceKindPlugin,
} from '../types';
import { pollUntil } from '../../lib/poll-until';
import { BROWSER_WINDOW_KIND } from './browser-window-spec';

/**
 * A browser step's own window (WCs/WC__window-tracking.md, Phase 4):
 * opened as a new window, named after its workspace, its tabs saved
 * whenever they change (browser-watch.ts) and once more just before
 * it's closed — whatever it holds then is the workspace's session, and
 * the next Restore reopens exactly that (browser-sessions.ts). The
 * browser itself and windows this app didn't open are never touched.
 *
 * Never the wrong window — a window counts as this step's only when
 * independent signals agree, every time it's acted on:
 * - opening: the browser reports exactly one new, unnamed window
 *   holding exactly the tabs that were opened; once named, exactly one
 *   window on screen shows that name at that frame, and it wasn't open
 *   before the step ran;
 * - after naming, and before every save or close: exactly one
 *   (non-incognito) window carries its name, and exactly one window on
 *   screen has that name's title and the same frame — the very one
 *   being acted on.
 * Anything less is left untracked or left open, with the reason —
 * never guessed (a guess once closed the user's own window, 2026-10-30).
 *
 * The name is also how it's found again after the browser restarts or
 * crashes (the browser keeps window names; its window ids don't).
 */

const HandleSchema = z.object({
  pid: z.number().int().positive(),
  windowId: z.number().int().positive(),
  bundleId: z.string().min(1),
  appName: z.string().min(1),
  /** Its name — unique among the browser's windows when given. */
  name: z.string().min(1),
  /** Its saved tabs' key (browser-sessions.ts). */
  identityKey: z.string().min(1),
});

export type BrowserWindowHandle = z.infer<typeof HandleSchema>;

export function parseBrowserWindowHandle(handle: ResourceHandle): BrowserWindowHandle | null {
  const parsed = HandleSchema.safeParse(handle);
  return parsed.success ? parsed.data : null;
}

const OptionsSchema = z.object({
  appName: z.string().min(1),
  windowName: z.string(),
  /** JSON list of URLs a step saved before windows remembered their tabs. */
  seedUrls: z.string().default('[]'),
});

interface Snapshot {
  /** Window ids before the step opened its own; null when they couldn't be listed. */
  windowIds: number[] | null;
  /** The browser's own window ids before; [] when it wasn't running, null when unreadable. */
  scriptIds: string[] | null;
}

export interface BrowserWindowKindDeps {
  helper: Pick<WlHelperClient, 'request'>;
  adapterFor: (appName: string) => BrowserAdapter;
  sessions: () => BrowserSessions | null;
  /** Starts saving this browser's windows on every change (browser-watch.ts). */
  watch: (bundleId: string, appName: string) => void;
}

// Chrome can take several seconds to create a window, more on a cold start.
const CAPTURE_TIMEOUT_MS = 15_000;
const CLOSE_WAIT_MS = 3_000;
const CONFIRM_TIMEOUT_MS = 3_000;

/**
 * A named window's title: "<name> - <app>", where Chrome inserts the
 * active tab's state after the name ("<name> - Pinned - <app>", "…
 * Audio playing …") and adds " - <profile>" when there are several
 * profiles — so: starts with the name, and is the app's own window.
 * Never enough on its own (a tab can be titled like a workspace): it's
 * always checked together with the window's name in the browser and
 * its frame.
 */
export function isNamedTitle(title: string, name: string, appName: string): boolean {
  return (
    title.startsWith(`${name} - `) &&
    (title.endsWith(` - ${appName}`) || title.includes(` - ${appName} - `))
  );
}

/** Scripting bounds and Accessibility frames of the same window are identical (spike). */
function sameFrame(a: BrowserWindow['frame'], b: HelperWindow['frame']): boolean {
  if (!b) return false;
  return (
    Math.abs(a.x - b.x) <= 2 &&
    Math.abs(a.y - b.y) <= 2 &&
    Math.abs(a.width - b.width) <= 2 &&
    Math.abs(a.height - b.height) <= 2
  );
}

/**
 * The tab that loads for real is often redirected straight away
 * (google.com → www.google.com/, a page adding its own path), so it
 * only has to stay on the same site; every other tab is a placeholder
 * that hasn't loaded and must match exactly.
 */
function sameSite(loaded: string, opened: string): boolean {
  const host = (url: string): string | null => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };
  const a = host(loaded);
  return a !== null && a === host(opened);
}

type Found =
  | { found: true; window: BrowserWindow; ax: HelperWindow }
  | {
      found: false;
      why: 'none' | 'ambiguous' | 'unreadable';
      /** Which check failed, in words — shown to the user, so a failure is never a mystery. */
      detail: string;
      read?: BrowserResult<never>;
    };

export function createBrowserWindowKind(
  deps: BrowserWindowKindDeps,
  timing: { captureTimeoutMs?: number; confirmTimeoutMs?: number } = {},
): ResourceKindPlugin {
  const captureTimeoutMs = timing.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
  const confirmTimeoutMs = timing.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;

  /**
   * The one window carrying `name`: exactly one non-incognito window
   * with that name in the browser, and exactly one window on screen with
   * that name's title and the same frame. Anything else isn't found.
   */
  async function findNamed(handle: {
    appName: string;
    bundleId: string;
    name: string;
  }): Promise<Found> {
    const read = await deps.adapterFor(handle.appName).readWindows();
    if (!read.ok) return { found: false, why: 'unreadable', detail: read.message, read };
    const named = read.value.filter((w) => !w.incognito && w.name === handle.name);
    if (named.length === 0) {
      return {
        found: false,
        why: 'none',
        detail: `no ${handle.appName} window is named "${handle.name}"`,
      };
    }
    if (named.length > 1) {
      return {
        found: false,
        why: 'ambiguous',
        detail: `${named.length} ${handle.appName} windows are named "${handle.name}"`,
      };
    }
    const window = named[0]!;
    // Chrome can be slow to answer Accessibility for a moment (right
    // after a tab read, say): look again for a short while before
    // concluding anything.
    let last = 'nothing';
    let why: 'none' | 'ambiguous' | 'unreadable' = 'none';
    const { value: onScreen } = await pollUntil(
      async () => {
        const listing = await deps.helper.request('listWindows', { bundleId: handle.bundleId });
        if (!listing.ok) {
          why = 'unreadable';
          last = `couldn't list windows: ${listing.error.message}`;
          return undefined;
        }
        const matches = listing.result.filter(
          (w) =>
            w.standard &&
            isNamedTitle(w.title, handle.name, handle.appName) &&
            sameFrame(window.frame, w.frame),
        );
        if (matches.length === 1) return matches[0]!;
        why = matches.length > 1 ? 'ambiguous' : 'none';
        last =
          matches.length > 1
            ? `${matches.length} windows on screen look like "${handle.name}"`
            : `no window on screen shows the name "${handle.name}" where ${handle.appName} says it is (on screen: ${
                listing.result
                  .map((w) => `${w.standard ? '' : '[not standard] '}"${w.title.slice(0, 60)}"`)
                  .join(', ') || 'no windows at all'
              })`;
        return undefined;
      },
      { intervalMs: 250, timeoutMs: 2_000 },
    );
    if (!onScreen) return { found: false, why, detail: last };
    return { found: true, window, ax: onScreen };
  }

  async function browserRunning(bundleId: string): Promise<boolean | null> {
    const running = await deps.helper.request('isRunning', { bundleId });
    return running.ok ? running.result.running : null;
  }

  /**
   * Where the window is now: its recorded id while that's alive; after
   * the browser restarted, the one window carrying its name. While the
   * browser isn't running it's 'unknown', not gone — it comes back with
   * the browser, and must be found again rather than opened twice.
   */
  async function locate(
    handle: BrowserWindowHandle,
  ): Promise<
    { state: 'alive' | 'gone'; handle: BrowserWindowHandle } | { state: 'unknown'; reason: string }
  > {
    const state = await deps.helper.request('windowState', {
      pid: handle.pid,
      windowId: handle.windowId,
    });
    if (!state.ok) return { state: 'unknown', reason: state.error.message };
    if (state.result.state !== 'gone') return { state: 'alive', handle };
    const running = await browserRunning(handle.bundleId);
    if (running === null) return { state: 'unknown', reason: `couldn't check ${handle.appName}` };
    // Quit: the window is gone (the workspace isn't active any more). If
    // the browser brings it back when it reopens, the next Restore takes
    // it back rather than keeping a second one (capture).
    if (!running) return { state: 'gone', handle };
    const found = await findNamed(handle);
    if (found.found) {
      return {
        state: 'alive',
        handle: { ...handle, pid: found.ax.pid, windowId: found.ax.windowId },
      };
    }
    if (found.why === 'unreadable') {
      return { state: 'unknown', reason: `couldn't read ${handle.appName}'s windows` };
    }
    return { state: 'gone', handle };
  }

  return {
    kind: BROWSER_WINDOW_KIND,
    // A second Restore must never open a second window.
    openIsIdempotent: false,
    closesWholeApp: false,

    async snapshot(identity, options): Promise<Snapshot> {
      const bundleId = String(identity['bundleId']);
      const listing = await deps.helper.request('listWindows', { bundleId });
      const windowIds = listing.ok ? listing.result.map((w) => w.windowId) : null;
      const parsed = OptionsSchema.safeParse(options);
      if (!parsed.success) return { windowIds, scriptIds: null };
      // Reading the browser here, at Restore, is also what makes macOS
      // ask for "control <browser>" the first time — never mid-Close.
      const read = await deps.adapterFor(parsed.data.appName).readWindows();
      const scriptIds = read.ok
        ? read.value.map((w) => w.scriptId)
        : read.code === 'not-running'
          ? []
          : null;
      if (!read.ok && read.code !== 'not-running') console.error(read.message);
      return { windowIds, scriptIds };
    },

    async capture(identity, snapshot, options): Promise<CaptureResult> {
      const parsedOptions = OptionsSchema.safeParse(options);
      if (!parsedOptions.success) {
        return { found: false, reason: 'no browser named for this window' };
      }
      const { appName, windowName, seedUrls } = parsedOptions.data;
      const bundleId = String(identity['bundleId']);
      const before = snapshot as Snapshot;
      if (before.windowIds === null || before.scriptIds === null) {
        return {
          found: false,
          reason: `couldn't read ${appName}'s windows before opening this one (is controlling ${appName} allowed?), so it can't be told apart`,
        };
      }
      const scriptIdsBefore = before.scriptIds;
      const windowIdsBefore = before.windowIds;
      const identityKey = identityKeyFor({ identity });
      const expected = expectedTabs(identityKey, seedUrls);
      const base = windowName.trim() || appName;
      const adapter = deps.adapterFor(appName);

      // The browser's own view decides which window is new: exactly one
      // new, unnamed window holding exactly the tabs opened. Several new
      // windows at once (a cold start restoring its last session) are
      // fine — only one can hold exactly these tabs.
      let fresh: BrowserWindow[] = [];
      const { value: opened } = await pollUntil(
        async () => {
          const read = await adapter.readWindows();
          if (!read.ok) return undefined;
          fresh = read.value.filter((w) => !w.incognito && !scriptIdsBefore.includes(w.scriptId));
          const matching = fresh.filter((w) => w.name === '' && holdsExactly(w, expected));
          return matching.length === 1 ? matching[0] : undefined;
        },
        { intervalMs: 500, timeoutMs: captureTimeoutMs },
      );
      if (!opened) {
        return {
          found: false,
          reason: `the new ${appName} window couldn't be told apart (it may have opened on another desktop)`,
        };
      }

      // The browser reopened this workspace's own window from before (it
      // was open when the browser quit): keep one. That copy's tabs were
      // saved as they changed — the new window holds the same — so the
      // old copy goes and the new one carries on.
      const restored = fresh.filter((w) => w.name === base);
      if (restored.length === 1) {
        const old = await findNamed({ appName, bundleId, name: base });
        if (old.found && !windowIdsBefore.includes(old.ax.windowId)) {
          await deps.helper.request('closeWindow', {
            pid: old.ax.pid,
            windowId: old.ax.windowId,
            waitMs: CLOSE_WAIT_MS,
          });
        }
      }

      const current = await adapter.readWindows();
      const taken = new Set(current.ok ? current.value.map((w) => w.name) : []);
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
      const naming = await adapter.nameWindow(opened.scriptId, name);
      if (!naming.ok) return { found: false, reason: naming.message };

      // Found on screen by that name and its frame — and new: never a
      // window that was already open before the step ran.
      const { value: onScreen } = await pollUntil(
        async () => {
          const found = await findNamed({ appName, bundleId, name });
          return found.found && !windowIdsBefore.includes(found.ax.windowId) ? found.ax : undefined;
        },
        { intervalMs: 150, timeoutMs: confirmTimeoutMs },
      );
      if (!onScreen) {
        await adapter.nameWindow(opened.scriptId, '');
        return {
          found: false,
          reason: `the new ${appName} window couldn't be confirmed on screen as the one named "${name}"`,
        };
      }

      const active = Math.min(
        deps.sessions()?.get(identityKey)?.activeTabIndex ?? 1,
        opened.tabs.length,
      );
      if (active > 1) await adapter.setActiveTab(opened.scriptId, active);
      deps.watch(bundleId, appName);
      return {
        found: true,
        handle: {
          pid: onScreen.pid,
          windowId: onScreen.windowId,
          bundleId,
          appName,
          name,
          identityKey,
        } satisfies BrowserWindowHandle,
        preexisting: false,
      };
    },

    async findLive() {
      // A window the user opened is never adopted as a step's.
      return null;
    },

    async check(raw): Promise<HandleState> {
      const handle = parseBrowserWindowHandle(raw);
      if (!handle) return { state: 'gone' };
      const located = await locate(handle);
      if (located.state === 'unknown') return located;
      if (located.state === 'gone') return { state: 'gone' };
      return located.handle === handle
        ? { state: 'alive' }
        : { state: 'alive', handle: located.handle };
    },

    async focus(raw) {
      const recorded = parseBrowserWindowHandle(raw);
      if (!recorded) return 'unreadable record';
      const located = await locate(recorded);
      if (located.state === 'unknown') return located.reason;
      if (located.state === 'gone') return 'its window is gone';
      const focused = await deps.helper.request('focusWindow', {
        pid: located.handle.pid,
        windowId: located.handle.windowId,
      });
      return focused.ok ? null : focused.error.message;
    },

    async close(raw): Promise<CloseOutcome> {
      const recorded = parseBrowserWindowHandle(raw);
      if (!recorded) return { outcome: 'already-gone' };
      const located = await locate(recorded);
      if (located.state === 'unknown') {
        return { outcome: 'failed', detail: `${located.reason} — nothing was closed` };
      }
      if (located.state === 'gone') return { outcome: 'already-gone' };
      const handle = located.handle;

      // Before anything is saved or closed: the window named for this
      // workspace must be exactly the window about to be closed.
      const found = await findNamed(handle);
      if (!found.found) {
        if (found.read && !found.read.ok && found.read.code === 'denied') {
          return {
            outcome: 'needs-permission',
            detail: `${found.read.message} Its tabs can't be saved until then, so it was left open.`,
          };
        }
        // Refused, not let go: the workspace keeps the window, so Close
        // can be tried again once whatever stood in the way is gone.
        return {
          outcome: 'refused',
          detail: `couldn't confirm which ${handle.appName} window is this workspace's (${found.detail}), so none was closed`,
        };
      }
      if (found.ax.windowId !== handle.windowId) {
        return {
          outcome: 'refused',
          detail: `the ${handle.appName} window named "${handle.name}" isn't the one this workspace opened, so none was closed`,
        };
      }

      const { window } = found;
      deps.sessions()?.save(handle.identityKey, {
        tabs: window.tabs,
        activeTabIndex: window.activeTabIndex,
      });

      const close = await deps.helper.request('closeWindow', {
        pid: handle.pid,
        windowId: handle.windowId,
        waitMs: CLOSE_WAIT_MS,
      });
      if (!close.ok) return { outcome: 'failed', detail: close.error.message };
      switch (close.result.outcome) {
        case 'closed':
          return { outcome: 'closed' };
        case 'already-gone':
          return { outcome: 'already-gone' };
        default: {
          const active = window.tabs[window.activeTabIndex - 1]?.title;
          return {
            outcome: 'refused',
            detail: `${active ? `"${active}"` : 'A page in it'} is asking before it closes (unsaved changes?) — answer it in ${handle.appName}, then Close again`,
          };
        }
      }
    },
  };

  /** The tabs this step opens: the ones last open in its window, else its old URLs (once). */
  function expectedTabs(identityKey: string, seedUrls: string): string[] {
    const saved = deps
      .sessions()
      ?.get(identityKey)
      ?.tabs.map((t) => t.url);
    if (saved) return saved;
    try {
      const seed: unknown = JSON.parse(seedUrls);
      return Array.isArray(seed) ? seed.filter((u): u is string => typeof u === 'string') : [];
    } catch {
      return [];
    }
  }
}

/**
 * Whether a just-opened window holds exactly the tabs that were opened:
 * the same number, in the same order, the not-yet-loaded ones at
 * exactly their URLs and the loaded first one on the same site. No URLs opens one
 * new-tab page; `chrome://` pages are dropped by Chrome itself when
 * opened this way. A window the user had can't match this by accident.
 */
function holdsExactly(window: BrowserWindow, expected: readonly string[]): boolean {
  const opened = expected.filter((url) => !url.startsWith('chrome://'));
  if (opened.length === 0) {
    return window.tabs.length === 1 && window.tabs[0]!.url.startsWith('chrome://newtab');
  }
  return (
    window.tabs.length === opened.length &&
    opened.every((url, i) =>
      i === 0 ? sameSite(window.tabs[0]!.url, url) : window.tabs[i]!.url === url,
    )
  );
}
