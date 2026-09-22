import { describe, expect, it } from 'vitest';
import type { WorkspaceConfig } from '@workspace-launcher/shared';
import { toWorkspaceDisplay } from './workspace-display';

function baseConfig(steps: WorkspaceConfig['steps']): WorkspaceConfig {
  return { version: 1, id: 'ws-1', name: 'Test workspace', steps };
}

describe('toWorkspaceDisplay', () => {
  it('carries over id and name as-is', () => {
    const display = toWorkspaceDisplay(baseConfig([]));
    expect(display.id).toBe('ws-1');
    expect(display.name).toBe('Test workspace');
  });

  it('always reports a never-restored config honestly', () => {
    const display = toWorkspaceDisplay(baseConfig([]));
    expect(display.lastRestored).toBe('Never');
    expect(display.restoreTime).toBe('—');
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
    ).toBe('1 tool · never restored');
    expect(
      toWorkspaceDisplay(
        baseConfig([
          { type: 'vscode', params: { path: '~/x' } },
          { type: 'docker', params: {} },
        ]),
      ).subtitle,
    ).toBe('2 tools · never restored');
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
});
