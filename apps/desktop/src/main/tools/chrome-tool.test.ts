import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROME_APP_NAME, ERROR_CODES } from '@workspace-launcher/shared';
import { chromeTool } from './chrome-tool';
import { resolveAppLaunchTarget } from './resolve-app-path';
import { getPlatformLauncher } from '../platform';
import { readBundleId } from '../platform/macos/bundle-id';
import { getBrowserSessions } from '../resources/runtime';
import { BrowserSessions } from '../resources/browser-sessions';
import { identityKeyFor } from '../resources/kind-registry';
import { placeholderUrl } from '../platform/browser-placeholder';

// Real detection shells out to plutil/scans /Applications — never
// exercised in a unit test, same precedent as every other filesystem/
// subprocess dependency in this suite. Its own logic is covered
// directly by app-detection.test.ts/resolve-app-path.test.ts.
vi.mock('./resolve-app-path', () => ({
  resolveAppLaunchTarget: vi.fn(),
}));
vi.mock('../platform', () => ({ getPlatformLauncher: vi.fn() }));
vi.mock('../platform/macos/bundle-id', () => ({ readBundleId: vi.fn() }));
vi.mock('electron-store', () => ({ default: class {} }));
/** What the fake browser answers: running with these windows, or not running. */
let browserWindowCounts: (number | 'not-running')[] = [];
vi.mock('../resources/runtime', () => ({
  getBrowserSessions: vi.fn(),
  browserAdapterFor: () => ({
    readWindows: async () => {
      const next =
        browserWindowCounts.length > 1
          ? browserWindowCounts.shift()!
          : (browserWindowCounts[0] ?? 1);
      return next === 'not-running'
        ? { ok: false, code: 'not-running', message: 'not running' }
        : { ok: true, value: Array.from({ length: next }, () => ({})) };
    },
  }),
}));

const mockedResolveAppLaunchTarget = vi.mocked(resolveAppLaunchTarget);
const openBrowserWindow = vi.fn();
const openUrlInBrowserProfile = vi.fn();
const CHROME = '/Applications/Google Chrome.app';

let sessions: BrowserSessions;

beforeEach(() => {
  mockedResolveAppLaunchTarget.mockReset().mockResolvedValue({ ok: true, target: CHROME });
  openBrowserWindow.mockReset().mockResolvedValue({ success: true, message: 'Opened.' });
  openUrlInBrowserProfile.mockReset().mockResolvedValue({ success: true, message: 'Opened.' });
  browserWindowCounts = [1];
  vi.mocked(getPlatformLauncher).mockReturnValue({
    launchApp: vi.fn(),
    openInApp: vi.fn(),
    openUrlInBrowserProfile,
    openBrowserWindow,
    openTerminal: vi.fn(),
    openFileDefault: vi.fn(),
    openUrlDefault: vi.fn(),
  });
  vi.mocked(readBundleId).mockReset().mockResolvedValue('com.google.Chrome');
  sessions = new BrowserSessions({ read: () => undefined, write: () => {} });
  vi.mocked(getBrowserSessions).mockReturnValue(sessions);
});

const CTX = { workspaceName: 'Client X', stepId: 'step-1' };
const RUN = { workspaceId: 'ws-1', stepId: 'step-1' };

/** What the last run opened, as `open`'s arguments would spell it. */
function openArgs(): string[] {
  const [browser, profile, urls] = openBrowserWindow.mock.calls.at(-1)! as [
    string,
    string,
    string[],
  ];
  return ['-n', '-a', browser, '--args', `--profile-directory=${profile}`, '--new-window', ...urls];
}

describe('chromeTool', () => {
  it('has type "chrome"', () => {
    expect(chromeTool.type).toBe('chrome');
  });

  describe('validate', () => {
    it('accepts a params object with a profile and zero or more urls', () => {
      expect(chromeTool.validate({ profile: 'Work', urls: [] })).toEqual({
        valid: true,
        data: { profile: 'Work', urls: [] },
      });
      expect(chromeTool.validate({ profile: 'Work', urls: ['https://example.com'] })).toEqual({
        valid: true,
        data: { profile: 'Work', urls: ['https://example.com'] },
      });
    });

    it('rejects params missing profile', () => {
      expect(chromeTool.validate({ urls: [] }).valid).toBe(false);
    });

    it('rejects an empty-string profile', () => {
      expect(chromeTool.validate({ profile: '', urls: [] }).valid).toBe(false);
    });

    it('accepts params missing urls, defaulting to an empty array (profile-only launch)', () => {
      const result = chromeTool.validate({ profile: 'Work' });
      expect(result).toEqual({ valid: true, data: { profile: 'Work', urls: [] } });
    });

    it('accepts and passes through an optional appPath', () => {
      const result = chromeTool.validate({
        profile: 'Work',
        urls: [],
        appPath: '/Applications/Google Chrome.app',
      });
      expect(result).toEqual({
        valid: true,
        data: { profile: 'Work', urls: [], appPath: '/Applications/Google Chrome.app' },
      });
    });

    it('rejects a urls array containing an empty string', () => {
      expect(chromeTool.validate({ profile: 'Work', urls: [''] }).valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(chromeTool.validate('Work').valid).toBe(false);
    });

    it('accepts an optional profileName alongside profile', () => {
      expect(chromeTool.validate({ profile: 'Profile 2', profileName: 'Work', urls: [] })).toEqual({
        valid: true,
        data: { profile: 'Profile 2', profileName: 'Work', urls: [] },
      });
    });
  });

  describe('resources', () => {
    it('declares the step’s own window, named after its workspace', async () => {
      const [spec] = await chromeTool.resources!(
        { profile: 'Profile 1', profileName: 'Work', urls: ['https://a.com'] },
        CTX,
      );
      expect(spec).toEqual({
        kind: 'browser-window',
        identity: { bundleId: 'com.google.Chrome', profile: 'Profile 1', stepId: 'step-1' },
        label: 'Google Chrome window (Work)',
        appName: 'Google Chrome',
        options: {
          appName: 'Google Chrome',
          windowName: 'Client X',
          seedUrls: '["https://a.com"]',
        },
      });
    });

    it('gives every step its own window — never one shared by two workspaces', async () => {
      const [a] = await chromeTool.resources!({ profile: 'Default', urls: [] }, CTX);
      const [b] = await chromeTool.resources!(
        { profile: 'Default', urls: [] },
        { workspaceName: 'Other', stepId: 'step-2' },
      );
      expect(identityKeyFor(a!)).not.toBe(identityKeyFor(b!));
    });

    it('stays untracked when the browser’s bundle can’t be read', async () => {
      vi.mocked(readBundleId).mockResolvedValueOnce(null);
      await expect(chromeTool.resources!({ profile: 'Default', urls: [] }, CTX)).resolves.toEqual(
        [],
      );
    });
  });

  describe('run', () => {
    it('opens the step’s URLs in a new window of its profile — the first tab real, the rest loading on click', async () => {
      const result = await chromeTool.run(
        { profile: 'Profile 1', profileName: 'Work', urls: ['https://a.com', 'https://b.com'] },
        RUN,
      );
      expect(openArgs()).toEqual([
        '-n',
        '-a',
        CHROME,
        '--args',
        '--profile-directory=Profile 1',
        '--new-window',
        'https://a.com',
        placeholderUrl('https://b.com', ''),
      ]);
      expect(result).toMatchObject({ success: true, message: expect.stringContaining('2 tabs') });
    });

    it('reopens the tabs last open in its window instead of the step’s old URLs', async () => {
      const [spec] = await chromeTool.resources!(
        { profile: 'Default', urls: ['https://a.com'] },
        CTX,
      );
      sessions.save(identityKeyFor(spec!), {
        tabs: [
          { title: 'Docs', url: 'https://docs.com' },
          { title: 'Mail', url: 'https://mail.com' },
        ],
        activeTabIndex: 2,
      });
      const result = await chromeTool.run({ profile: 'Default', urls: ['https://a.com'] }, RUN);
      expect(openArgs().slice(6)).toEqual([
        'https://docs.com',
        placeholderUrl('https://mail.com', 'Mail'),
      ]);
      expect(result.message).toContain('from last time');
    });

    it('reuses its window while it’s open — never a second one', async () => {
      const [spec] = await chromeTool.resources!({ profile: 'Default', urls: [] }, CTX);
      const result = await chromeTool.run(
        { profile: 'Default', urls: [] },
        { ...RUN, liveResourceKeys: new Set([identityKeyFor(spec!)]) },
      );
      expect(openBrowserWindow).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, message: expect.stringContaining('reused') });
    });

    it('opens the profile on its own first when the browser isn’t running, and waits for its windows', async () => {
      // Not running, then starting up: 1 window, 2 (its last session coming back), 2 — settled.
      browserWindowCounts = ['not-running', 1, 2, 2];
      await chromeTool.run({ profile: 'Default', urls: ['https://a.com'] }, RUN);
      expect(openUrlInBrowserProfile).toHaveBeenCalledWith(CHROME, 'Default');
      expect(openUrlInBrowserProfile.mock.invocationCallOrder[0]).toBeLessThan(
        openBrowserWindow.mock.invocationCallOrder[0]!,
      );
      expect(browserWindowCounts).toEqual([2]);
    }, 10_000);

    it('never starts a browser that’s already running', async () => {
      await chromeTool.run({ profile: 'Default', urls: [] }, RUN);
      expect(openUrlInBrowserProfile).not.toHaveBeenCalled();
    });

    it('opens an empty window of the profile when the step has no URLs', async () => {
      await chromeTool.run({ profile: 'Default', urls: [] }, RUN);
      expect(openArgs().at(-1)).toBe('--new-window');
    });

    it('fails loudly and never opens the browser at all when resolution fails', async () => {
      mockedResolveAppLaunchTarget.mockResolvedValue({
        ok: false,
        message: 'Google Chrome not found at /old/path — it may have moved or been uninstalled.',
      });

      const result = await chromeTool.run({ profile: 'Work', urls: ['https://a.com'] }, RUN);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found at /old/path');
      expect(result.message).toContain('Chrome was not opened');
      expect(result.code).toBe(ERROR_CODES.APP_PATH_NOT_FOUND.code);
      expect(openBrowserWindow).not.toHaveBeenCalled();
    });

    it('reports a failed open as a failed step', async () => {
      openBrowserWindow.mockResolvedValue({
        success: false,
        message: `Failed to open a ${CHROME_APP_NAME} window (profile: Default): boom`,
      });
      const result = await chromeTool.run({ profile: 'Default', urls: [] }, RUN);
      expect(result).toMatchObject({
        success: false,
        code: ERROR_CODES.CHROME_TABS_FAILED.code,
        message: expect.stringContaining(CHROME_APP_NAME),
      });
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await chromeTool.teardown({ profile: 'Work', urls: [] });
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('says it reopens the tabs last open in its own window — whatever old URLs it has', () => {
      const expected = 'Opens its own Chrome window (profile: Work) with the tabs last open in it.';
      expect(chromeTool.detail?.({ profile: 'Work', urls: [] })).toBe(expected);
      expect(chromeTool.detail?.({ profile: 'Work', urls: ['https://a.com'] })).toBe(expected);
    });

    it('degrades gracefully when profile is missing/invalid raw input', () => {
      // detail() takes RAW params, not validated data — must never
      // throw on a hand-edited/legacy config that fails validate()
      // (profile is schema-required, but that only gates run()/save).
      expect(chromeTool.detail?.({ urls: [] })).toBe('Opens Chrome — no profile configured yet.');
      expect(chromeTool.detail?.({})).toBe('Opens Chrome — no profile configured yet.');
    });

    it('prefers the human profileName over the raw folder name when present', () => {
      expect(chromeTool.detail?.({ profile: 'Profile 2', profileName: 'Work', urls: [] })).toBe(
        'Opens its own Chrome window (profile: Work) with the tabs last open in it.',
      );
    });

    it('falls back to the raw folder name when no profileName is set (legacy config)', () => {
      expect(chromeTool.detail?.({ profile: 'Profile 2', urls: [] })).toBe(
        'Opens its own Chrome window (profile: Profile 2) with the tabs last open in it.',
      );
    });
  });

  describe('expand', () => {
    it('returns just the Profile row — even for a step with old URLs', () => {
      expect(chromeTool.expand?.({ profile: 'Work', urls: ['https://a.com'] })).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
      ]);
      expect(chromeTool.expand?.({ profile: 'Work', urls: [] })).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
      ]);
    });

    it('returns undefined when profile is missing/invalid raw input', () => {
      expect(chromeTool.expand?.({ urls: [] })).toBeUndefined();
      expect(chromeTool.expand?.({})).toBeUndefined();
    });

    it('uses the human profileName in the Profile row when present', () => {
      expect(chromeTool.expand?.({ profile: 'Profile 2', profileName: 'Work', urls: [] })).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
      ]);
    });
  });
});
