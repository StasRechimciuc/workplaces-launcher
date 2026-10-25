import { describe, expect, it } from 'vitest';
import {
  chromeStepSummary,
  clockifyStepSummary,
  dockerStepSummary,
  linkStepSummary,
  spotifyStepSummary,
  terminalStepSummary,
  vscodeStepSummary,
} from './step-summaries';

describe('vscodeStepSummary', () => {
  it('reports no path set when empty', () => {
    expect(vscodeStepSummary({})).toBe('No path set');
    expect(vscodeStepSummary({ path: '   ' })).toBe('No path set');
  });

  it('shows just the path with no commands', () => {
    expect(vscodeStepSummary({ path: '~/projects/x' })).toBe('~/projects/x');
  });

  it('appends a singular/plural command count', () => {
    const oneCommand = { path: '~/x', terminals: [{ commands: ['npm run dev'] }] };
    expect(vscodeStepSummary(oneCommand)).toBe('~/x, 1 command');

    const twoCommands = { path: '~/x', terminals: [{ commands: ['npm i', 'npm run dev'] }] };
    expect(vscodeStepSummary(twoCommands)).toBe('~/x, 2 commands');
  });
});

describe('chromeStepSummary', () => {
  it('reports no profile set when empty', () => {
    expect(chromeStepSummary({})).toBe('No profile set');
  });

  it('shows just the profile with no tabs', () => {
    expect(chromeStepSummary({ profile: 'Default' })).toBe('Default');
  });

  it('appends a singular/plural tab count', () => {
    expect(chromeStepSummary({ profile: 'Default', urls: ['https://a.com'] })).toBe(
      'Default, 1 tab',
    );
    expect(
      chromeStepSummary({ profile: 'Default', urls: ['https://a.com', 'https://b.com'] }),
    ).toBe('Default, 2 tabs');
  });

  it('shows the human profileName instead of the raw folder name when set', () => {
    expect(chromeStepSummary({ profile: 'Profile 2', profileName: 'Work' })).toBe('Work');
    expect(
      chromeStepSummary({ profile: 'Profile 2', profileName: 'Work', urls: ['https://a.com'] }),
    ).toBe('Work, 1 tab');
  });
});

describe('spotifyStepSummary', () => {
  it('reports no playlist set when empty', () => {
    expect(spotifyStepSummary({})).toBe('No playlist set');
  });

  it('falls back to "Playlist configured" for a URI with no name (legacy config)', () => {
    expect(spotifyStepSummary({ playlist: 'spotify:playlist:abc' })).toBe('Playlist configured');
  });

  it('shows the human playlist name when set', () => {
    expect(
      spotifyStepSummary({ playlist: 'spotify:playlist:abc', playlistName: 'Deep Focus' }),
    ).toBe('Deep Focus');
  });
});

describe('clockifyStepSummary', () => {
  it('reports "App not detected yet" when no path is set', () => {
    expect(clockifyStepSummary({})).toBe('App not detected yet');
    expect(clockifyStepSummary({ appPath: '   ' })).toBe('App not detected yet');
  });

  it('shows the resolved app name when a path is set', () => {
    expect(clockifyStepSummary({ appPath: '/Applications/Clockify.app' })).toBe('Clockify');
  });
});

describe('terminalStepSummary', () => {
  it('reports no terminals configured when empty', () => {
    expect(terminalStepSummary({})).toBe('No terminals configured');
    expect(terminalStepSummary({ terminals: [] })).toBe('No terminals configured');
  });

  it('reports a singular/plural terminal count', () => {
    expect(terminalStepSummary({ terminals: [{ cwd: '~/x', commands: [] }] })).toBe('1 terminal');
    expect(
      terminalStepSummary({
        terminals: [
          { cwd: '~/x', commands: [] },
          { cwd: '~/y', commands: [] },
        ],
      }),
    ).toBe('2 terminals');
  });
});

describe('dockerStepSummary', () => {
  it('reports no directory set when empty', () => {
    expect(dockerStepSummary({})).toBe('No directory set');
    expect(dockerStepSummary({ directory: '   ' })).toBe('No directory set');
  });

  it('names the engine and directory, defaulting to Docker Compose', () => {
    expect(dockerStepSummary({ directory: '/x' })).toBe('Docker Compose, /x');
    expect(dockerStepSummary({ directory: '/x', engine: 'compose' })).toBe('Docker Compose, /x');
    expect(dockerStepSummary({ directory: '/x', engine: 'tilt' })).toBe('Tilt, /x');
  });
});

describe('linkStepSummary', () => {
  it('reports no file or link set when empty', () => {
    expect(linkStepSummary({})).toBe('No file or link set');
    expect(linkStepSummary({ target: '   ' })).toBe('No file or link set');
  });

  it('shows just the target with no open-with override', () => {
    expect(linkStepSummary({ target: 'https://example.com' })).toBe('https://example.com');
  });

  it('appends the resolved app name when appPath is set', () => {
    expect(
      linkStepSummary({
        target: 'https://www.figma.com/file/abc',
        appPath: '/Applications/Figma.app',
      }),
    ).toBe('https://www.figma.com/file/abc, opens with Figma');
  });
});
