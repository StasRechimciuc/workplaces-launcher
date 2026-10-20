import type { SpotifyConnection } from '../../lib/useSpotifyConnection';
import type { AppPathDetection } from '../../lib/useAppPathDetections';

/**
 * Shape every per-tool-type params-form component implements — see
 * registry.ts for the type-keyed lookup that replaces
 * WorkspaceFormModal.tsx's old `if (preset.type === X)` chain.
 */
export interface StepFieldsProps {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  /**
   * Only the row's *primary* field should call this — it's what
   * WorkspaceFormModal.tsx's pendingFocusKeyRef effect focuses once a
   * preset is picked from the Add-tool dropdown. A component with no
   * input simply never calls it; the focus effect's `?.focus()` is
   * already a safe no-op then.
   */
  registerPrimaryInputRef: (el: HTMLInputElement | null) => void;
  /**
   * Optional, type-specific quick-pick suggestions (currently only
   * populated for vscode's project-path field — see WorkspaceFormModal
   * .tsx's StepParamsFields). Every other field component simply never
   * reads it.
   */
  recentFolders?: string[];
  /**
   * The shared, app-wide Spotify connection (see
   * lib/useSpotifyConnection.ts) — only spotify-fields.tsx reads it,
   * same precedent as recentFolders above. Bundles actions (connect/
   * disconnect/fetchPlaylists), not just derived data, because — unlike
   * recentFolders — this is real connection *state* that every row
   * must agree on, not a per-row snapshot.
   */
  spotify?: SpotifyConnection;
  /**
   * This row's slice of the lifted app-location detection cache (see
   * lib/useAppPathDetections.ts) — only vscode/chrome/spotify/clockify
   * fields read it, same precedent as recentFolders/spotify above.
   * Lifted to WorkspaceFormModal rather than owned locally by
   * ResolvedAppPath.tsx because a row's fields block fully unmounts on
   * collapse (WorkspaceFormModal's `hasFields && isOpen` gate) — local
   * state would re-fetch on every single re-expand.
   */
  appPathDetection?: AppPathDetection;
}

export type StepFieldsComponent = (props: StepFieldsProps) => JSX.Element | null;
