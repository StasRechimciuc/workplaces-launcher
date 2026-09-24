import { getFirstTerminalCommands } from './vscode-terminal-params';

/**
 * A one-line, live-updating summary for a collapsed "Tools" row in
 * WorkspaceFormModal — the whole point of collapsing a row is to still
 * be able to tell its state without expanding it, so this reads the
 * draft's actual params, not just the preset's static hint text (that
 * stays how it's shown for non-collapsible types — see
 * stepFieldsHasPrimaryInput in step-fields/registry.ts).
 *
 * Only covers the 3 collapsible types (vscode/chrome/spotify) — every
 * other type keeps showing its preset's static config hint instead of
 * calling this at all.
 */
export function stepRowSummary(type: string, params: Record<string, unknown>): string {
  switch (type) {
    case 'vscode': {
      const path = typeof params['path'] === 'string' ? params['path'].trim() : '';
      if (!path) return 'No path set';
      const count = getFirstTerminalCommands(params).length;
      return count > 0 ? `${path}, ${count} command${count === 1 ? '' : 's'}` : path;
    }
    case 'chrome': {
      const profile = typeof params['profile'] === 'string' ? params['profile'].trim() : '';
      if (!profile) return 'No profile set';
      const urls = Array.isArray(params['urls']) ? params['urls'] : [];
      const count = urls.length;
      return count > 0 ? `${profile}, ${count} tab${count === 1 ? '' : 's'}` : profile;
    }
    case 'spotify': {
      const playlist = typeof params['playlist'] === 'string' ? params['playlist'].trim() : '';
      return playlist ? 'Playlist configured' : 'No playlist set';
    }
    default:
      return '';
  }
}
