import { useCallback, useEffect, useState } from 'react';
import type { SpotifyPlaylist } from '@workspace-launcher/shared';
import { useIsMounted } from './useIsMounted';

export type SpotifyConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | {
      status: 'connected';
      accountName?: string;
      playlists: SpotifyPlaylist[] | null;
      playlistsLoading: boolean;
      playlistsError: string | null;
    }
  | { status: 'error'; message: string };

export interface SpotifyConnection {
  state: SpotifyConnectionState;
  connect: () => void;
  disconnect: () => void;
  retry: () => void;
  /** Lazy by design — fetches playlists only when called (e.g. the
   * picker dropdown's first open), not on connect/mount, so simply
   * having the Spotify step connected doesn't cost a network call every
   * time the workspace form opens. A no-op once playlists are already
   * loaded or a fetch is already in flight. */
  fetchPlaylists: () => void;
}

/**
 * Owns the app-wide Spotify connection state for the lifetime of one
 * WorkspaceFormModal mount — instantiated once there (same altitude as
 * its `recentFolders` useMemo) and threaded down to SpotifyFields via
 * StepFieldsProps.spotify, not re-derived per row. Connection status is
 * genuinely app-wide (one Spotify account, not one per workspace step),
 * so per-row local state — the shape vscode-fields.tsx's Browse button
 * uses — would risk two rows disagreeing about whether Spotify is
 * connected.
 */
export function useSpotifyConnection(): SpotifyConnection {
  const [state, setState] = useState<SpotifyConnectionState>({ status: 'disconnected' });
  const isMountedRef = useIsMounted();

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.api.getSpotifyStatus();
      if (!isMountedRef.current) return;
      setState(
        status.connected
          ? {
              status: 'connected',
              ...(status.displayName !== undefined ? { accountName: status.displayName } : {}),
              playlists: null,
              playlistsLoading: false,
              playlistsError: null,
            }
          : { status: 'disconnected' },
      );
    } catch (err) {
      if (!isMountedRef.current) return;
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [isMountedRef]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(() => {
    setState({ status: 'connecting' });
    window.api
      .connectSpotify()
      .then((result) => {
        if (!isMountedRef.current) return;
        if (result.success) {
          setState({
            status: 'connected',
            accountName: result.displayName,
            playlists: null,
            playlistsLoading: false,
            playlistsError: null,
          });
        } else {
          setState({ status: 'error', message: result.error });
        }
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, [isMountedRef]);

  const disconnect = useCallback(() => {
    window.api
      .disconnectSpotify()
      .then(() => {
        if (isMountedRef.current) {
          setState({ status: 'disconnected' });
        }
      })
      .catch((err: unknown) => {
        if (isMountedRef.current) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
  }, [isMountedRef]);

  const fetchPlaylists = useCallback(() => {
    setState((current) => {
      if (current.status !== 'connected' || current.playlistsLoading || current.playlists) {
        return current;
      }
      return { ...current, playlistsLoading: true, playlistsError: null };
    });

    window.api
      .listSpotifyPlaylists()
      .then((result) => {
        if (!isMountedRef.current) return;
        setState((current) => {
          if (current.status !== 'connected') return current;
          return result.success
            ? { ...current, playlists: result.playlists, playlistsLoading: false }
            : { ...current, playlistsLoading: false, playlistsError: result.error };
        });
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        setState((current) => {
          if (current.status !== 'connected') return current;
          return {
            ...current,
            playlistsLoading: false,
            playlistsError: err instanceof Error ? err.message : String(err),
          };
        });
      });
  }, [isMountedRef]);

  return { state, connect, disconnect, retry: connect, fetchPlaylists };
}
