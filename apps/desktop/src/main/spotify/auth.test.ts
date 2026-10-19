import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { shell } from 'electron';
import { runLoopbackAuth } from './oauth-server';
import { loadDisplayName, loadRefreshToken, saveCredentials } from './token-store';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

vi.mock('./oauth-server', () => ({
  runLoopbackAuth: vi.fn(),
}));

vi.mock('./token-store', () => ({
  saveCredentials: vi.fn(),
  loadRefreshToken: vi.fn(),
  loadDisplayName: vi.fn(),
  clearCredentials: vi.fn(),
}));

// Imported after the mocks (hoisted by Vitest regardless of source order).
import { connect, disconnect, getValidAccessToken, SpotifyReauthRequiredError } from './auth';
import { clearCredentials } from './token-store';

const originalFetch = global.fetch;
const originalClientId = process.env['SPOTIFY_CLIENT_ID'];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('spotify/auth', () => {
  beforeEach(() => {
    process.env['SPOTIFY_CLIENT_ID'] = 'test-client-id';
    disconnect(); // resets the module-level in-memory access-token cache
    vi.mocked(clearCredentials).mockClear();
    vi.mocked(saveCredentials).mockClear();
    vi.mocked(loadRefreshToken).mockReset();
    vi.mocked(loadDisplayName).mockReset();
    vi.mocked(runLoopbackAuth).mockReset();
    vi.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env['SPOTIFY_CLIENT_ID'] = originalClientId;
    global.fetch = originalFetch;
  });

  describe('connect', () => {
    it('fails loudly, without opening the browser, when SPOTIFY_CLIENT_ID is unset', async () => {
      delete process.env['SPOTIFY_CLIENT_ID'];

      const result = await connect();

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('SPOTIFY_CLIENT_ID'),
        code: ERROR_CODES.SPOTIFY_CONNECT_FAILED.code,
      });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('opens the system browser and persists credentials on a full successful round trip', async () => {
      vi.mocked(runLoopbackAuth).mockReturnValue({
        port: Promise.resolve(54321),
        result: Promise.resolve({ code: 'auth-code' }),
        cancel: vi.fn(),
      });
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          jsonResponse({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' }),
        )
        .mockResolvedValueOnce(jsonResponse({ id: 'user-1', display_name: 'Stas' }));

      const result = await connect();

      expect(shell.openExternal).toHaveBeenCalledTimes(1);
      const openedUrl = new URL(
        (shell.openExternal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
      );
      expect(openedUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
      expect(saveCredentials).toHaveBeenCalledWith('refresh-1', 'Stas');
      expect(result).toEqual({ success: true, displayName: 'Stas' });
    });

    it('reports a failure, not a throw, when the token exchange request fails', async () => {
      vi.mocked(runLoopbackAuth).mockReturnValue({
        port: Promise.resolve(54321),
        result: Promise.resolve({ code: 'auth-code' }),
        cancel: vi.fn(),
      });
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, false, 500));

      const result = await connect();

      expect(result.success).toBe(false);
    });

    it('reports a failure when the user cancels/denies in the browser', async () => {
      const result = Promise.reject(new Error('Spotify authorization was denied (access_denied).'));
      result.catch(() => {}); // see oauth-server.ts's own identical no-op catch — same reasoning here
      vi.mocked(runLoopbackAuth).mockReturnValue({
        port: Promise.resolve(54321),
        result,
        cancel: vi.fn(),
      });

      const outcome = await connect();

      expect(outcome).toEqual({
        success: false,
        error: expect.stringContaining('denied'),
        code: ERROR_CODES.SPOTIFY_CONNECT_FAILED.code,
      });
    });

    it('cancels the loopback server when shell.openExternal rejects, instead of leaving it listening', async () => {
      const cancel = vi.fn();
      const result = new Promise<{ code: string }>(() => {}); // never settles on its own in this test
      vi.mocked(runLoopbackAuth).mockReturnValue({
        port: Promise.resolve(54321),
        result,
        cancel,
      });
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no default browser'));

      const outcome = await connect();

      expect(outcome).toEqual({
        success: false,
        error: expect.stringContaining('no default browser'),
        code: ERROR_CODES.SPOTIFY_CONNECT_FAILED.code,
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('getValidAccessToken', () => {
    it('throws SpotifyReauthRequiredError immediately when nothing is stored', async () => {
      vi.mocked(loadRefreshToken).mockReturnValue(null);

      await expect(getValidAccessToken()).rejects.toBeInstanceOf(SpotifyReauthRequiredError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refreshes and returns a new access token via the stored refresh token', async () => {
      vi.mocked(loadRefreshToken).mockReturnValue('stored-refresh-token');
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-2', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ id: 'user-1', display_name: 'Stas' }));

      const token = await getValidAccessToken();

      expect(token).toBe('access-2');
    });

    it('clears credentials and throws SpotifyReauthRequiredError on invalid_grant', async () => {
      vi.mocked(loadRefreshToken).mockReturnValue('revoked-refresh-token');
      vi.mocked(global.fetch).mockResolvedValueOnce(
        jsonResponse({ error: 'invalid_grant' }, false, 400),
      );

      await expect(getValidAccessToken()).rejects.toBeInstanceOf(SpotifyReauthRequiredError);
      expect(clearCredentials).toHaveBeenCalledTimes(1);
    });
  });
});
