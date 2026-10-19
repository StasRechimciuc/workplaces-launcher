import { getFirstTerminalCommands } from '../../lib/vscode-terminal-params';

/**
 * One-line, live-updating summaries for each collapsible type's row in
 * WorkspaceFormModal — see registry.ts's `summary` doc comment for why
 * this reads the draft's actual params rather than a static hint text.
 *
 * Kept in their own pure (non-component) file rather than alongside
 * each type's *-fields.tsx component: mixing a React component export
 * with a plain function export in the same file breaks Fast Refresh
 * (eslint's react-refresh/only-export-components) — confirmed by lint
 * when these briefly lived there during this refactor.
 */

export function vscodeStepSummary(params: Record<string, unknown>): string {
  const path = typeof params['path'] === 'string' ? params['path'].trim() : '';
  if (!path) return 'No path set';
  const count = getFirstTerminalCommands(params).length;
  return count > 0 ? `${path}, ${count} command${count === 1 ? '' : 's'}` : path;
}

export function chromeStepSummary(params: Record<string, unknown>): string {
  const profile = typeof params['profile'] === 'string' ? params['profile'].trim() : '';
  if (!profile) return 'No profile set';
  // Prefers the real display name; falls back to the raw folder name
  // for a config saved before profileName existed.
  const name = typeof params['profileName'] === 'string' ? params['profileName'].trim() : '';
  const label = name || profile;
  const urls = Array.isArray(params['urls']) ? params['urls'] : [];
  const count = urls.length;
  return count > 0 ? `${label}, ${count} tab${count === 1 ? '' : 's'}` : label;
}

export function spotifyStepSummary(params: Record<string, unknown>): string {
  const name = typeof params['playlistName'] === 'string' ? params['playlistName'].trim() : '';
  if (name) return name;
  // Legacy/hand-edited config with a URI but no name captured yet.
  const playlist = typeof params['playlist'] === 'string' ? params['playlist'].trim() : '';
  return playlist ? 'Playlist configured' : 'No playlist set';
}
