import { Icon } from '../../icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { StepFieldsProps } from './types';
import { FIELD_GROUP_LABEL_CLASS, ResolvedAppPath } from './ResolvedAppPath';

const BUTTON_CLASS =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.25 text-[12px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50';

/**
 * One component with conditional rendering per connection state, not a
 * separate component per state — no second OAuth-picker consumer exists
 * yet to justify extracting one (EditableStringList's own precedent:
 * extract after two real duplicates, not ahead of need).
 *
 * No free-text URI field (deliberate, per founder decision) — OAuth is
 * the only way to set a playlist. With nothing chosen, restoring this
 * step just opens Spotify plain (spotify-tool.ts's own existing
 * fallback when `playlist` is empty) — there's no manual-paste
 * workaround to preserve a path for.
 */
export function SpotifyFields({
  params,
  onChange,
  registerPrimaryInputRef: _registerPrimaryInputRef, // unused — no <input> here; see step-fields/registry.ts's hasPrimaryInput: false for spotify
  spotify,
  appPathDetection,
}: StepFieldsProps): JSX.Element {
  const state = spotify?.state ?? { status: 'disconnected' as const };
  const playlistName = typeof params['playlistName'] === 'string' ? params['playlistName'] : '';
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'] : '';

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_GROUP_LABEL_CLASS}>App</span>
      <ResolvedAppPath
        toolLabel="Spotify"
        appPath={appPath}
        onChange={onChange}
        detection={appPathDetection!}
      />

      <span className={`${FIELD_GROUP_LABEL_CLASS} mt-1`}>Playlist</span>
      <div className="flex items-center gap-1.5">
        {state.status === 'disconnected' && (
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => {
              spotify?.connect();
            }}
          >
            <Icon name="music" size={12} />
            Connect Spotify to open a specific playlist
          </button>
        )}

        {state.status === 'connecting' && (
          <button type="button" disabled className={BUTTON_CLASS}>
            <Icon name="music" size={12} />
            Connecting… check your browser
          </button>
        )}

        {state.status === 'connected' && (
          <>
            <DropdownMenu
              onOpenChange={(isOpen) => {
                if (isOpen) {
                  spotify?.fetchPlaylists();
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button type="button" className={BUTTON_CLASS}>
                  <Icon name="music" size={12} />
                  {playlistName ? 'Change playlist' : 'Choose playlist'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                {state.playlistsLoading && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
                {state.playlistsError && (
                  <DropdownMenuItem disabled>{state.playlistsError}</DropdownMenuItem>
                )}
                {state.playlists?.length === 0 && (
                  <DropdownMenuItem disabled>No playlists found</DropdownMenuItem>
                )}
                {state.playlists?.map((playlist) => (
                  <DropdownMenuItem
                    key={playlist.id}
                    title={playlist.name}
                    className="max-w-72 truncate"
                    onSelect={() => {
                      onChange({ playlist: playlist.uri, playlistName: playlist.name });
                    }}
                  >
                    {playlist.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="min-w-0 truncate text-[11px] text-text-faint">
              {playlistName || state.accountName || 'Connected'}
            </span>
            <button
              type="button"
              className="ml-auto shrink-0 text-[11px] text-text-faint hover:text-danger"
              onClick={() => {
                spotify?.disconnect();
              }}
            >
              Disconnect
            </button>
          </>
        )}

        {state.status === 'error' && (
          <button
            type="button"
            className={`${BUTTON_CLASS} border-danger text-danger`}
            onClick={() => {
              spotify?.retry();
            }}
          >
            <Icon name="x" size={12} />
            Couldn&rsquo;t connect — Retry
          </button>
        )}
      </div>

      {state.status === 'error' && <p className="text-[11px] text-danger">{state.message}</p>}
    </div>
  );
}
