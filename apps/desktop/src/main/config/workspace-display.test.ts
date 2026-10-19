import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '@workspace-launcher/shared';
import { toWorkspaceDisplay } from './workspace-display';
import { registerBuiltInTools } from '../tools';

// step-timing-history.ts is backed by electron-store, which needs a
// real Electron `app` to resolve its storage path — unavailable under
// Vitest. Mocked out entirely; its own averaging/threshold logic is
// covered by step-timing-history.test.ts instead. Defaults to "no
// history for anything" (undefined) so existing tests that don't care
// about launchTime keep passing unchanged.
const getTypicalStepDurationMs = vi.fn((_toolType: string): number | undefined => undefined);
vi.mock('../orchestrator/step-timing-history', () => ({
  getTypicalStepDurationMs: (...args: [string]) => getTypicalStepDurationMs(...args),
}));

// describeStep (workspace-display.ts) now looks tools up via the real
// registry to call their detail()/expand() methods — same setup
// handlers.test.ts already needs for the same reason.
beforeAll(() => {
  registerBuiltInTools();
});

beforeEach(() => {
  getTypicalStepDurationMs.mockReset().mockReturnValue(undefined);
});

function baseConfig(steps: WorkspaceConfig['steps']): WorkspaceConfig {
  return { version: 1, id: 'ws-1', name: 'Test workspace', steps };
}

describe('toWorkspaceDisplay', () => {
  it('carries over id and name as-is', () => {
    const display = toWorkspaceDisplay(baseConfig([]));
    expect(display.id).toBe('ws-1');
    expect(display.name).toBe('Test workspace');
  });

  describe('launchTime', () => {
    it('reports "—" / no-steps for a workspace with zero steps', () => {
      const display = toWorkspaceDisplay(baseConfig([]));
      expect(display.launchTime).toEqual({ display: '—', state: 'no-steps' });
    });

    it('reports "Not yet measured" / unmeasured for a step with no history', () => {
      const display = toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: { path: '~/x' } }]));
      expect(display.tools[0]?.launchTime).toEqual({
        display: 'Not yet measured',
        state: 'unmeasured',
      });
    });

    it('reports an approximate time / full once a step type has enough history', () => {
      getTypicalStepDurationMs.mockReturnValue(3000);
      const display = toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: { path: '~/x' } }]));
      expect(display.tools[0]?.launchTime).toEqual({ display: '~3s', state: 'full' });
    });

    it('reports workspace-level "Not yet measured" when no step type has history', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/x' } },
          { type: 'chrome', params: {} },
        ]),
      );
      expect(display.launchTime).toEqual({ display: 'Not yet measured', state: 'unmeasured' });
    });

    it('sums every step type\'s typical duration for a clean "full" total when all have history', () => {
      getTypicalStepDurationMs.mockImplementation((type) =>
        type === 'vscode' ? 3000 : type === 'chrome' ? 5000 : undefined,
      );
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/x' } },
          { type: 'chrome', params: {} },
        ]),
      );
      expect(display.launchTime).toEqual({ display: '~8s', state: 'full' });
    });

    it('reports a "partial" total, with a steps-timed count, when only some step types have history', () => {
      getTypicalStepDurationMs.mockImplementation((type) => (type === 'vscode' ? 3000 : undefined));
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/x' } },
          { type: 'chrome', params: {} },
        ]),
      );
      expect(display.launchTime).toEqual({
        display: '~3s · 1/2 steps timed',
        state: 'partial',
      });
    });

    it('sums each occurrence independently for two steps of the same type, not just once per distinct type', () => {
      getTypicalStepDurationMs.mockReturnValue(3000);
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/a' } },
          { type: 'vscode', params: { path: '~/b' } },
        ]),
      );
      // Two real launches of the same tool type should roughly double
      // the total, not collapse to one step's worth.
      expect(display.launchTime).toEqual({ display: '~6s', state: 'full' });
    });
  });

  it("looks up a known step type's icon/color/name from STEP_TYPES", () => {
    const display = toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: { path: '~/x' } }]));
    expect(display.tools[0]).toMatchObject({
      icon: 'codeTwo',
      color: 'blue',
      name: 'VS Code',
      type: 'vscode',
    });
  });

  it('writes a real, honest detail line for an implemented vscode step', () => {
    const display = toWorkspaceDisplay(
      baseConfig([{ type: 'vscode', params: { path: '~/projects/x' } }]),
    );
    expect(display.tools[0]?.detail).toContain('~/projects/x');
  });

  it('writes a real, honest detail line for an implemented chrome step with tabs', () => {
    const display = toWorkspaceDisplay(
      baseConfig([
        { type: 'chrome', params: { profile: 'Work', urls: ['https://a.com', 'https://b.com'] } },
      ]),
    );
    expect(display.tools[0]?.detail).toBe('Opens 2 tabs in Chrome (profile: Work).');
  });

  it('writes a real, honest detail line for an implemented chrome step with zero tabs', () => {
    const display = toWorkspaceDisplay(
      baseConfig([{ type: 'chrome', params: { profile: 'Work', urls: [] } }]),
    );
    expect(display.tools[0]?.detail).toBe('Opens Chrome (profile: Work).');
  });

  it('writes a real, honest detail line for an implemented spotify step with a playlist', () => {
    const display = toWorkspaceDisplay(
      baseConfig([{ type: 'spotify', params: { playlist: 'spotify:playlist:abc' } }]),
    );
    expect(display.tools[0]?.detail).toBe('Opens spotify:playlist:abc in Spotify.');
  });

  it('writes a real, honest detail line for an implemented spotify step with no playlist', () => {
    const display = toWorkspaceDisplay(baseConfig([{ type: 'spotify', params: {} }]));
    expect(display.tools[0]?.detail).toBe('Opens Spotify.');
  });

  it('does not pretend a not-yet-built tool type does something', () => {
    const display = toWorkspaceDisplay(baseConfig([{ type: 'docker', params: {} }]));
    expect(display.tools[0]?.detail.toLowerCase()).toContain("isn't built yet");
  });

  it('falls back gracefully for a step type unknown to STEP_TYPES, without crashing', () => {
    const display = toWorkspaceDisplay(baseConfig([{ type: 'totally-unknown', params: {} }]));
    expect(display.tools[0]?.name).toBe('totally-unknown');
    expect(display.tools[0]?.detail).toContain('totally-unknown');
  });

  it('derives a singular/plural tool-count subtitle', () => {
    expect(
      toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: { path: '~/x' } }])).subtitle,
    ).toBe('1 tool');
    expect(
      toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/x' } },
          { type: 'docker', params: {} },
        ]),
      ).subtitle,
    ).toBe('2 tools');
  });

  it('assigns the same tag color deterministically for the same id', () => {
    const a = toWorkspaceDisplay(baseConfig([]));
    const b = toWorkspaceDisplay(baseConfig([]));
    expect(a.tag).toBe(b.tag);
  });

  describe('expand', () => {
    it('gives a vscode step a Path row', () => {
      const display = toWorkspaceDisplay(
        baseConfig([{ type: 'vscode', params: { path: '~/projects/x' } }]),
      );
      expect(display.tools[0]?.expand).toEqual([
        { i: 'folder', label: 'Path', mono: '~/projects/x' },
      ]);
    });

    it('gives a chrome step a Profile row plus one Tab row per url', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'chrome', params: { profile: 'Work', urls: ['https://a.com', 'https://b.com'] } },
        ]),
      );
      expect(display.tools[0]?.expand).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
        { i: 'check', label: 'Tab', mono: 'https://a.com' },
        { i: 'check', label: 'Tab', mono: 'https://b.com' },
      ]);
    });

    it('gives a spotify step a Playlist row when one is set', () => {
      const display = toWorkspaceDisplay(
        baseConfig([{ type: 'spotify', params: { playlist: 'spotify:playlist:abc' } }]),
      );
      expect(display.tools[0]?.expand).toEqual([
        { i: 'music', label: 'Playlist', mono: 'spotify:playlist:abc' },
      ]);
    });

    it('leaves expand undefined (not an empty array) when there is nothing structured to show', () => {
      expect(
        toWorkspaceDisplay(baseConfig([{ type: 'spotify', params: {} }])).tools[0]?.expand,
      ).toBeUndefined();
      expect(
        toWorkspaceDisplay(baseConfig([{ type: 'docker', params: {} }])).tools[0]?.expand,
      ).toBeUndefined();
      expect(
        toWorkspaceDisplay(baseConfig([{ type: 'chrome', params: { urls: [] } }])).tools[0]?.expand,
      ).toBeUndefined();
    });
  });

  describe('description', () => {
    it('reports "No tools added yet." for an empty workspace', () => {
      expect(toWorkspaceDisplay(baseConfig([])).description).toBe('No tools added yet.');
    });

    it('names the single tool for a one-step workspace', () => {
      const display = toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: {} }]));
      expect(display.description).toBe('VS Code, restored in order below.');
    });

    it('joins two tool names with "and", no Oxford comma', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: {} },
          { type: 'chrome', params: {} },
        ]),
      );
      expect(display.description).toBe('VS Code and Chrome, restored in order below.');
    });

    it('joins three tool names as "A, B and C"', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: {} },
          { type: 'chrome', params: {} },
          { type: 'spotify', params: {} },
        ]),
      );
      expect(display.description).toBe('VS Code, Chrome and Spotify, restored in order below.');
    });

    it('collapses four or more tool names to the first three plus a count', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: {} },
          { type: 'chrome', params: {} },
          { type: 'spotify', params: {} },
          { type: 'docker', params: {} },
        ]),
      );
      expect(display.description).toBe(
        'VS Code, Chrome, Spotify and 1 more, restored in order below.',
      );
    });
  });

  describe("the generic 'app' type's dynamic name", () => {
    it("shows the real app's name, not the static STEP_TYPES name, once a path is chosen", () => {
      const display = toWorkspaceDisplay(
        baseConfig([{ type: 'app', params: { path: '/Applications/Figma.app' } }]),
      );
      expect(display.tools[0]?.name).toBe('Figma');
    });

    it('falls back to the generic STEP_TYPES name ("App") when no path is chosen yet', () => {
      const display = toWorkspaceDisplay(baseConfig([{ type: 'app', params: {} }]));
      expect(display.tools[0]?.name).toBe('App');
    });

    it('still uses the static STEP_TYPES name for every other type (unaffected)', () => {
      const display = toWorkspaceDisplay(baseConfig([{ type: 'vscode', params: { path: '~/x' } }]));
      expect(display.tools[0]?.name).toBe('VS Code');
    });

    it('distinguishes two different app steps in the same workspace by name', () => {
      const display = toWorkspaceDisplay(
        baseConfig([
          { type: 'app', params: { path: '/Applications/Figma.app' } },
          { type: 'app', params: { path: '/System/Applications/Music.app' } },
        ]),
      );
      expect(display.tools[0]?.name).toBe('Figma');
      expect(display.tools[1]?.name).toBe('Music');
    });
  });
});
