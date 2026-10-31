import { appDisplayName } from '@workspace-launcher/shared';
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
  // Its tabs are whatever was last open in its window — not part of the step.
  return name || profile;
}

export function spotifyStepSummary(params: Record<string, unknown>): string {
  const name = typeof params['playlistName'] === 'string' ? params['playlistName'].trim() : '';
  if (name) return name;
  // Legacy/hand-edited config with a URI but no name captured yet.
  const playlist = typeof params['playlist'] === 'string' ? params['playlist'].trim() : '';
  return playlist ? 'Playlist configured' : 'No playlist set';
}

/**
 * Clockify's only configurable thing is which real app it launches —
 * see ResolvedAppPath.tsx, which this summary mirrors for the
 * collapsed row. Unlike the other three summaries above, this one IS
 * the resolved app path by necessity, not by consistency-for-its-own-
 * sake: every other type's summary already identifies the primary
 * thing that row does, with the resolved binary path shown inline in
 * the expanded fields block instead (a secondary, lower-stakes detail
 * not worth competing for space in their one-line summaries).
 */
export function clockifyStepSummary(params: Record<string, unknown>): string {
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'].trim() : '';
  return appPath ? appDisplayName(appPath) : 'App not detected yet';
}

export function terminalStepSummary(params: Record<string, unknown>): string {
  const terminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
  const count = terminals.length;
  if (count === 0) return 'No terminals configured';
  return `${count} terminal${count === 1 ? '' : 's'}`;
}

export function dockerStepSummary(params: Record<string, unknown>): string {
  const directory = typeof params['directory'] === 'string' ? params['directory'].trim() : '';
  if (!directory) return 'No directory set';
  const engineLabel = params['engine'] === 'tilt' ? 'Tilt' : 'Docker Compose';
  return `${engineLabel}, ${directory}`;
}

export function linkStepSummary(params: Record<string, unknown>): string {
  const target = typeof params['target'] === 'string' ? params['target'].trim() : '';
  if (!target) return 'No file or link set';
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'].trim() : '';
  return appPath ? `${target}, opens with ${appDisplayName(appPath)}` : target;
}
