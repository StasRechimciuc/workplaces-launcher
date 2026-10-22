import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCurrentWorkspaceDraft } from './workspace-detection';
import { listForegroundApps, type ListForegroundAppsResult, type RunningApp } from '../platform/macos/app-enumeration';
import { getLastUsedChromeProfileFolder } from '../platform/chrome-profiles';
import { inspectTerminalAppWindows } from '../platform/macos/terminal-inspection';
import { isOrchestratorBusy } from './orchestrator-busy';
import { listOpenWindowFolders } from '@workspace-launcher/shared/vscode-restore';

vi.mock('../platform/macos/app-enumeration', () => ({ listForegroundApps: vi.fn() }));
vi.mock('../platform/chrome-profiles', () => ({ getLastUsedChromeProfileFolder: vi.fn() }));
vi.mock('../platform/macos/terminal-inspection', () => ({ inspectTerminalAppWindows: vi.fn() }));
vi.mock('./orchestrator-busy', () => ({ isOrchestratorBusy: vi.fn() }));
vi.mock('@workspace-launcher/shared/vscode-restore', () => ({ listOpenWindowFolders: vi.fn() }));

const mockedListForegroundApps = vi.mocked(listForegroundApps);
const mockedGetLastUsedChromeProfileFolder = vi.mocked(getLastUsedChromeProfileFolder);
const mockedInspectTerminalAppWindows = vi.mocked(inspectTerminalAppWindows);
const mockedIsOrchestratorBusy = vi.mocked(isOrchestratorBusy);
const mockedListOpenWindowFolders = vi.mocked(listOpenWindowFolders);

/** Shorthand for a successful enumeration result — the common case
 * throughout this file; the "enumeration itself failed" case is tested
 * explicitly and separately below. */
function apps(list: RunningApp[]): ListForegroundAppsResult {
  return { success: true, apps: list };
}

beforeEach(() => {
  mockedListForegroundApps.mockReset().mockResolvedValue(apps([]));
  mockedGetLastUsedChromeProfileFolder.mockReset().mockResolvedValue(undefined);
  mockedInspectTerminalAppWindows.mockReset().mockResolvedValue([]);
  mockedIsOrchestratorBusy.mockReset().mockReturnValue(false);
  mockedListOpenWindowFolders.mockReset().mockResolvedValue([]);
});

describe('detectCurrentWorkspaceDraft', () => {
  it('reports "blocked" and performs no detection at all when the orchestrator is busy', async () => {
    mockedIsOrchestratorBusy.mockReturnValue(true);

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toEqual({ status: 'blocked' });
    expect(mockedListForegroundApps).not.toHaveBeenCalled();
  });

  it('returns an empty, ready draft when nothing recognizable is running', async () => {
    mockedListForegroundApps.mockResolvedValue(apps([]));

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toEqual({ status: 'ready', steps: [], unmatched: [], issues: [] });
  });

  it('reports a top-level issue, never a silently-empty-looking draft, when enumeration itself fails', async () => {
    mockedListForegroundApps.mockResolvedValue({ success: false, apps: [] });

    const result = await detectCurrentWorkspaceDraft();

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.steps).toEqual([]);
      expect(result.issues).toEqual([expect.stringContaining("Couldn't scan")]);
    }
  });

  it('builds a spotify step with no extra params', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([{ name: 'Spotify', bundleId: 'com.spotify.client', bundlePath: '/Applications/Spotify.app' }]),
    );

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toMatchObject({
      status: 'ready',
      steps: [{ type: 'spotify', params: {}, label: 'Spotify' }],
    });
  });

  it('builds a clockify step with no extra params', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([{ name: 'Clockify', bundleId: undefined, bundlePath: '/Applications/Clockify Desktop.app' }]),
    );

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toMatchObject({
      status: 'ready',
      steps: [{ type: 'clockify', params: {}, label: 'Clockify Desktop' }],
    });
  });

  it('builds a chrome step with the best-guess profile and a caveat flagging it as a guess', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([
        { name: 'Google Chrome', bundleId: 'com.google.Chrome', bundlePath: '/Applications/Google Chrome.app' },
      ]),
    );
    mockedGetLastUsedChromeProfileFolder.mockResolvedValue('Profile 2');

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toMatchObject({
      status: 'ready',
      steps: [
        {
          type: 'chrome',
          params: { profile: 'Profile 2' },
          label: 'Chrome (Profile 2)',
          caveat: expect.stringContaining('best guess'),
        },
      ],
    });
  });

  it('builds a chrome step with no profile param and a different caveat when the profile could not be resolved', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([
        { name: 'Google Chrome', bundleId: 'com.google.Chrome', bundlePath: '/Applications/Google Chrome.app' },
      ]),
    );
    mockedGetLastUsedChromeProfileFolder.mockResolvedValue(undefined);

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toMatchObject({
      status: 'ready',
      steps: [{ type: 'chrome', params: {}, caveat: expect.stringContaining('Could not determine') }],
    });
  });

  it('falls back to a generic "app" step for a running app with no dedicated plugin — included by default, never unmatched', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([{ name: 'Figma', bundleId: 'com.figma.Desktop', bundlePath: '/Applications/Figma.app' }]),
    );

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toEqual({
      status: 'ready',
      steps: [{ type: 'app', params: { path: '/Applications/Figma.app' }, label: 'Figma' }],
      unmatched: [],
      issues: [],
    });
  });

  it('reports an app with no bundlePath as unmatched, never as a generic app step', async () => {
    mockedListForegroundApps.mockResolvedValue(apps([{ name: 'some-tool', bundleId: undefined, bundlePath: undefined }]));

    const result = await detectCurrentWorkspaceDraft();

    expect(result).toEqual({
      status: 'ready',
      steps: [],
      unmatched: [{ name: 'some-tool' }],
      issues: [],
    });
  });

  describe('VS Code', () => {
    it('builds one vscode step per open folder reported by the companion extension', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          { name: 'Code', bundleId: 'com.microsoft.VSCode', bundlePath: '/Applications/Visual Studio Code.app' },
        ]),
      );
      mockedListOpenWindowFolders.mockResolvedValue(['/Users/me/projects/a', '/Users/me/projects/b']);

      const result = await detectCurrentWorkspaceDraft();

      expect(result).toMatchObject({
        status: 'ready',
        steps: [
          { type: 'vscode', params: { path: '/Users/me/projects/a' }, label: '/Users/me/projects/a' },
          { type: 'vscode', params: { path: '/Users/me/projects/b' }, label: '/Users/me/projects/b' },
        ],
      });
    });

    it('falls back to a generic "app" step, with a caveat, when VS Code is running but no folder was reported', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          { name: 'Code', bundleId: 'com.microsoft.VSCode', bundlePath: '/Applications/Visual Studio Code.app' },
        ]),
      );
      mockedListOpenWindowFolders.mockResolvedValue([]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result).toMatchObject({
        status: 'ready',
        steps: [
          {
            type: 'app',
            params: { path: '/Applications/Visual Studio Code.app' },
            label: 'Visual Studio Code',
            caveat: expect.stringContaining('extension'),
          },
        ],
      });
    });

    it('never double-reports VS Code through the generic app-step fallback loop', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          { name: 'Code', bundleId: 'com.microsoft.VSCode', bundlePath: '/Applications/Visual Studio Code.app' },
        ]),
      );
      mockedListOpenWindowFolders.mockResolvedValue(['/Users/me/projects/a']);

      const result = await detectCurrentWorkspaceDraft();

      expect(result.status).toBe('ready');
      if (result.status === 'ready') {
        expect(result.steps).toHaveLength(1);
      }
    });
  });

  describe('Terminal', () => {
    it('builds one terminal step per window, with cwd + the running command', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          {
            name: 'Terminal',
            bundleId: 'com.apple.Terminal',
            bundlePath: '/System/Applications/Utilities/Terminal.app',
          },
        ]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([
        { cwd: '/Users/me/projects/a', command: 'npm run dev' },
      ]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result).toMatchObject({
        status: 'ready',
        steps: [
          {
            type: 'terminal',
            params: { terminals: [{ cwd: '/Users/me/projects/a', commands: ['npm run dev'] }] },
            label: '/Users/me/projects/a — npm run dev',
          },
        ],
      });
      expect(mockedInspectTerminalAppWindows).toHaveBeenCalledWith('Terminal');
    });

    it('builds a terminal step with an empty commands list and a caveat for an idle window', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          {
            name: 'Terminal',
            bundleId: 'com.apple.Terminal',
            bundlePath: '/System/Applications/Utilities/Terminal.app',
          },
        ]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([{ cwd: '/Users/me/x', command: undefined }]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result).toMatchObject({
        status: 'ready',
        steps: [
          {
            type: 'terminal',
            params: { terminals: [{ cwd: '/Users/me/x', commands: [] }] },
            caveat: expect.stringContaining('No running command'),
          },
        ],
      });
    });

    it('skips a window with no recoverable cwd at all, without an issue or a broken step when every other window is fine', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          {
            name: 'Terminal',
            bundleId: 'com.apple.Terminal',
            bundlePath: '/System/Applications/Utilities/Terminal.app',
          },
        ]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([{ cwd: '/Users/me/ok', command: 'npm run dev' }, { cwd: undefined, command: undefined }]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result.status).toBe('ready');
      if (result.status === 'ready') {
        expect(result.steps).toHaveLength(1);
        // The dropped window is still named explicitly, never silent.
        expect(result.issues).toEqual([expect.stringContaining('1 of 2 window')]);
      }
    });

    it('reports a top-level issue, not a silent gap, when a running terminal app has zero inspectable windows', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          {
            name: 'Terminal',
            bundleId: 'com.apple.Terminal',
            bundlePath: '/System/Applications/Utilities/Terminal.app',
          },
        ]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result.status).toBe('ready');
      if (result.status === 'ready') {
        expect(result.issues).toEqual([expect.stringContaining('Terminal')]);
        expect(result.steps).toEqual([]);
      }
    });

    it('never falls through to the generic app-step branch for Terminal.app itself', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([
          {
            name: 'Terminal',
            bundleId: 'com.apple.Terminal',
            bundlePath: '/System/Applications/Utilities/Terminal.app',
          },
        ]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([{ cwd: '/Users/me', command: undefined }]);

      const result = await detectCurrentWorkspaceDraft();

      expect(result.status).toBe('ready');
      if (result.status === 'ready') {
        expect(result.steps.every((s) => s.type === 'terminal')).toBe(true);
      }
    });

    it('queries iTerm2 separately when it, not Terminal.app, is the one running', async () => {
      mockedListForegroundApps.mockResolvedValue(
        apps([{ name: 'iTerm2', bundleId: 'com.googlecode.iterm2', bundlePath: '/Applications/iTerm.app' }]),
      );
      mockedInspectTerminalAppWindows.mockResolvedValue([{ cwd: '/Users/me', command: undefined }]);

      await detectCurrentWorkspaceDraft();

      expect(mockedInspectTerminalAppWindows).toHaveBeenCalledWith('iTerm2');
    });
  });

  it('combines every category in one pass: vscode, terminal, chrome, a generic app, and an unmatched entry together', async () => {
    mockedListForegroundApps.mockResolvedValue(
      apps([
        { name: 'Code', bundleId: 'com.microsoft.VSCode', bundlePath: '/Applications/Visual Studio Code.app' },
        {
          name: 'Terminal',
          bundleId: 'com.apple.Terminal',
          bundlePath: '/System/Applications/Utilities/Terminal.app',
        },
        { name: 'Google Chrome', bundleId: 'com.google.Chrome', bundlePath: '/Applications/Google Chrome.app' },
        { name: 'Figma', bundleId: 'com.figma.Desktop', bundlePath: '/Applications/Figma.app' },
        { name: 'mystery-tool', bundleId: undefined, bundlePath: undefined },
      ]),
    );
    mockedListOpenWindowFolders.mockResolvedValue(['/Users/me/projects/a']);
    mockedInspectTerminalAppWindows.mockResolvedValue([{ cwd: '/Users/me/projects/a', command: 'npm run dev' }]);
    mockedGetLastUsedChromeProfileFolder.mockResolvedValue('Default');

    const result = await detectCurrentWorkspaceDraft();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.steps.map((s) => s.type).sort()).toEqual(['app', 'chrome', 'terminal', 'vscode']);
    expect(result.unmatched).toEqual([{ name: 'mystery-tool' }]);
    expect(result.issues).toEqual([]);
  });
});
