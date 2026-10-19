/**
 * Shared between main (spotify/playlists.ts, spotify/auth.ts) and the
 * renderer (preload's typed api, lib/useSpotifyConnection.ts) — pure
 * type-only shapes, no runtime code, so these are safe to import from
 * either process (including the sandboxed preload) with zero bundling
 * risk regardless of whether the import is type-only or not.
 */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  /** Owned by the connected account, not just followed — see
   * spotify/playlists.ts's doc comment for why this distinction is
   * kept (not filtered out) at the data layer. */
  ownedByCurrentUser: boolean;
}

export type SpotifyConnectResult =
  | { success: true; displayName: string }
  | { success: false; error: string; code: string };

export interface SpotifyStatus {
  connected: boolean;
  displayName?: string;
}

export type SpotifyListPlaylistsResult =
  | { success: true; playlists: SpotifyPlaylist[] }
  | { success: false; error: 'reauth-required' | string; code: string };
