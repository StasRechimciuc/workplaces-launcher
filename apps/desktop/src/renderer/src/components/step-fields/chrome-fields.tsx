import { useState } from 'react';
import type { ChromeProfileInfo } from '@workspace-launcher/shared';
import { Icon } from '../../icons';
import { useIsMounted } from '../../lib/useIsMounted';
import { EditableStringList } from '../EditableStringList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { StepFieldsProps } from './types';

const BUTTON_CLASS =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.25 text-[12px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50';

/**
 * Chrome's own real profiles, read from its Local State file (see
 * main/platform/chrome-profiles.ts) — no OAuth, no "connect" step. No
 * app-wide hook needed (unlike useSpotifyConnection.ts): this is a
 * stateless local read with nothing to keep consistent across rows, so
 * plain local state inside this component is enough. Fetched lazily on
 * the picker's first open, same convention as spotify-fields.tsx's
 * fetchPlaylists — avoids a read nobody asked for on every modal open.
 *
 * URLs render via EditableStringList — same reasoning as
 * vscode-fields.tsx's terminal commands: an in-progress empty row is a
 * normal editing state, only surfaced as this tool's own "each url must
 * be a non-empty string" save-time validation error if left blank.
 */
export function ChromeFields({
  params,
  onChange,
  registerPrimaryInputRef: _registerPrimaryInputRef, // unused — no <input> here; see step-fields/registry.ts's hasPrimaryInput: false for chrome, same precedent as SpotifyFields
}: StepFieldsProps): JSX.Element {
  const [profiles, setProfiles] = useState<ChromeProfileInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useIsMounted();

  const urls = Array.isArray(params['urls'])
    ? params['urls'].filter((u): u is string => typeof u === 'string')
    : [];
  const profile = typeof params['profile'] === 'string' ? params['profile'] : '';
  const profileName = typeof params['profileName'] === 'string' ? params['profileName'] : '';

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen || profiles !== null || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    window.api
      .listChromeProfiles()
      .then((result) => {
        if (!isMountedRef.current) return;
        if (result.success) {
          setProfiles(result.profiles);
        } else {
          setError(result.error);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <DropdownMenu onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={BUTTON_CLASS}>
              <Icon name="globe" size={12} />
              {profile ? 'Change profile' : 'Choose profile'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {loading && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
            {error && <DropdownMenuItem disabled>{error}</DropdownMenuItem>}
            {profiles?.length === 0 && <DropdownMenuItem disabled>No Chrome profiles found</DropdownMenuItem>}
            {profiles?.map((p) => (
              <DropdownMenuItem
                key={p.folder}
                title={p.name}
                className="max-w-72 truncate"
                onSelect={() => {
                  onChange({ profile: p.folder, profileName: p.name });
                }}
              >
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {profile && (
          <span className="min-w-0 truncate text-[11px] text-text-faint">{profileName || profile}</span>
        )}
      </div>

      <EditableStringList
        values={urls}
        onChange={(next) => {
          onChange({ urls: next });
        }}
        placeholder="e.g. https://example.com"
        addLabel="Add URL"
        removeAriaLabel="Remove URL"
      />
    </div>
  );
}
