import type { SpotifyConnection } from '../../lib/useSpotifyConnection';

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
}

export type StepFieldsComponent = (props: StepFieldsProps) => JSX.Element | null;
