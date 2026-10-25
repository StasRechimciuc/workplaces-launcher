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
   * Distinct terminal commands already used across the user's saved
   * workspaces (see lib/recent-commands.ts) — only terminal-fields.tsx
   * reads it, same precedent as recentFolders above.
   */
  recentCommands?: string[];
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
  /**
   * This row's per-field save-time validation errors, keyed by the
   * tool's own top-level param field name (e.g. `{ directory: '...' }`
   * for docker-fields.tsx) — see packages/shared's ValidationResult/
   * zodValidate for where this is computed, and WorkspaceFormModal.tsx
   * for how it's threaded down to only the one row that actually
   * failed. Absent on every row until a save attempt fails, and on
   * every row except the one step that failed even then — a field
   * component reads its own key(s) and applies the shared
   * border-danger/text-danger error styling (see AppHotkeyControl.tsx /
   * spotify-fields.tsx's connection-error state for the established
   * visual convention this follows).
   */
  fieldErrors?: Record<string, string>;
}

export type StepFieldsComponent = (props: StepFieldsProps) => JSX.Element | null;
