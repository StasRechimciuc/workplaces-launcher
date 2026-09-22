import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spotifyTool } from './spotify-tool';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const launchApp = vi.fn();
const openInApp = vi.fn();

beforeEach(() => {
  launchApp.mockReset();
  openInApp.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp,
    openInApp,
    openUrlInBrowserProfile: vi.fn(),
  });
});

describe('spotifyTool', () => {
  it('has type "spotify"', () => {
    expect(spotifyTool.type).toBe('spotify');
  });

  describe('validate', () => {
    it('accepts an absent playlist', () => {
      expect(spotifyTool.validate({})).toEqual({ valid: true, data: {} });
    });

    it('accepts an explicit empty-string playlist (the UI\'s "left blank" value)', () => {
      expect(spotifyTool.validate({ playlist: '' })).toEqual({
        valid: true,
        data: { playlist: '' },
      });
    });

    it('accepts a spotify: URI', () => {
      expect(spotifyTool.validate({ playlist: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' })).toEqual(
        {
          valid: true,
          data: { playlist: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
        },
      );
    });

    it('accepts an https://open.spotify.com/ link', () => {
      expect(
        spotifyTool.validate({
          playlist: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ',
        }),
      ).toEqual({
        valid: true,
        data: { playlist: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ' },
      });
    });

    it('rejects a friendly playlist name that is not a real spotify link', () => {
      const result = spotifyTool.validate({ playlist: 'Deep Focus' });
      if (result.valid) {
        throw new Error('expected validation to fail');
      }
      expect(result.errors[0]).toContain('spotify:');
    });

    it('rejects non-object input', () => {
      expect(spotifyTool.validate('Deep Focus').valid).toBe(false);
    });
  });

  describe('run', () => {
    it('opens the playlist in Spotify via the platform launcher when given a valid link', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      const result = await spotifyTool.run(
        { playlist: 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ' },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).toHaveBeenCalledWith('Spotify', 'spotify:playlist:37i9dQZF1DWZeKCadgRdKQ');
      expect(launchApp).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('just launches Spotify (no target) when playlist is blank', async () => {
      launchApp.mockResolvedValueOnce({ success: true, message: 'Launched Spotify.' });

      const result = await spotifyTool.run({ playlist: '' }, { workspaceId: 'ws-1' });

      expect(launchApp).toHaveBeenCalledWith('Spotify');
      expect(openInApp).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('just launches Spotify (no target) when playlist is absent', async () => {
      launchApp.mockResolvedValueOnce({ success: true, message: 'Launched Spotify.' });

      const result = await spotifyTool.run({}, { workspaceId: 'ws-1' });

      expect(launchApp).toHaveBeenCalledWith('Spotify');
      expect(result.success).toBe(true);
    });

    it('surfaces a platform-launcher failure as a failed StepResult, not a throw', async () => {
      openInApp.mockResolvedValueOnce({ success: false, message: 'Spotify not installed' });

      const result = await spotifyTool.run(
        { playlist: 'spotify:playlist:abc' },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Spotify not installed');
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await spotifyTool.teardown({});
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('names the playlist when present', () => {
      expect(spotifyTool.detail?.({ playlist: 'spotify:playlist:abc' })).toBe(
        'Opens spotify:playlist:abc in Spotify.',
      );
    });

    it('falls back to a generic message when playlist is absent/blank/invalid raw input', () => {
      expect(spotifyTool.detail?.({})).toBe('Opens Spotify.');
      expect(spotifyTool.detail?.({ playlist: '' })).toBe('Opens Spotify.');
      expect(spotifyTool.detail?.({ playlist: 42 })).toBe('Opens Spotify.');
    });
  });

  describe('expand', () => {
    it('returns a Playlist row when present', () => {
      expect(spotifyTool.expand?.({ playlist: 'spotify:playlist:abc' })).toEqual([
        { i: 'music', label: 'Playlist', mono: 'spotify:playlist:abc' },
      ]);
    });

    it('returns undefined when playlist is absent/blank', () => {
      expect(spotifyTool.expand?.({})).toBeUndefined();
      expect(spotifyTool.expand?.({ playlist: '' })).toBeUndefined();
    });
  });
});
