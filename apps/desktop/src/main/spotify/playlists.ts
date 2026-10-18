import type { SpotifyPlaylist } from '@workspace-launcher/shared';
import { getCachedAccountId, getValidAccessToken } from './auth';

interface SpotifyApiPlaylist {
  id: string;
  name: string;
  uri: string;
  owner: { id: string };
}

interface SpotifyApiPlaylistsPage {
  items: SpotifyApiPlaylist[];
  next: string | null;
}

/**
 * Fetches every playlist visible to the connected account (owned and
 * followed — Spotify's own /me/playlists endpoint mixes both), paging
 * through `next` until exhausted, and maps each to this app's own
 * shape. ownedByCurrentUser is kept rather than filtered out here so
 * the UI can decide how to group/show them, instead of this layer
 * silently dropping data a future UI might want.
 */
export async function listPlaylists(): Promise<SpotifyPlaylist[]> {
  const accessToken = await getValidAccessToken();
  const accountId = getCachedAccountId();

  const seen = new Map<string, SpotifyPlaylist>();
  let url: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      throw new Error(`Failed to fetch Spotify playlists (${response.status}).`);
    }
    const page = (await response.json()) as SpotifyApiPlaylistsPage;
    for (const item of page.items) {
      seen.set(item.id, {
        id: item.id,
        name: item.name,
        uri: item.uri,
        ownedByCurrentUser: item.owner.id === accountId,
      });
    }
    url = page.next;
  }

  return [...seen.values()];
}
