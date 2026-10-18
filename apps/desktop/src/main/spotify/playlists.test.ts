import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedAccountId, getValidAccessToken } from './auth';
import { listPlaylists } from './playlists';

vi.mock('./auth', () => ({
  getValidAccessToken: vi.fn(),
  getCachedAccountId: vi.fn(),
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

describe('listPlaylists', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.mocked(getValidAccessToken).mockReset().mockResolvedValue('access-token');
    vi.mocked(getCachedAccountId).mockReset().mockReturnValue('me');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps a single page of results to the app-owned shape', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        items: [{ id: '1', name: 'Deep Focus', uri: 'spotify:playlist:1', owner: { id: 'me' } }],
        next: null,
      }),
    );

    const playlists = await listPlaylists();

    expect(playlists).toEqual([
      { id: '1', name: 'Deep Focus', uri: 'spotify:playlist:1', ownedByCurrentUser: true },
    ]);
  });

  it('follows the next URL across multiple pages and merges the results', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: '1', name: 'Page 1', uri: 'spotify:playlist:1', owner: { id: 'me' } }],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: '2', name: 'Page 2', uri: 'spotify:playlist:2', owner: { id: 'someone-else' } }],
          next: null,
        }),
      );

    const playlists = await listPlaylists();

    expect(playlists.map((p) => p.id)).toEqual(['1', '2']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('dedupes by id if the same playlist appears across pages', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: '1', name: 'Dup', uri: 'spotify:playlist:1', owner: { id: 'me' } }],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: '1', name: 'Dup', uri: 'spotify:playlist:1', owner: { id: 'me' } }],
          next: null,
        }),
      );

    const playlists = await listPlaylists();

    expect(playlists).toHaveLength(1);
  });

  it('flags ownedByCurrentUser false for a playlist owned by someone else', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        items: [{ id: '1', name: 'Followed', uri: 'spotify:playlist:1', owner: { id: 'someone-else' } }],
        next: null,
      }),
    );

    const playlists = await listPlaylists();

    expect(playlists[0]?.ownedByCurrentUser).toBe(false);
  });

  it('throws when a page request fails, rather than returning a partial silent list', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    await expect(listPlaylists()).rejects.toThrow(/Failed to fetch Spotify playlists/);
  });
});
