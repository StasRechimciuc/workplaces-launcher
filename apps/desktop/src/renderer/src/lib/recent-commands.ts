import type { WorkspaceDisplay } from '../../../preload';

/**
 * Distinct terminal commands already used across the user's saved
 * workspaces' terminal steps — same derivation precedent as
 * recent-project-paths.ts's getRecentProjectPaths (no separate
 * "history" store; commands already saved as part of each workspace's
 * own terminal steps are the only source, surfaced here rather than
 * tracked a second time). Most-recently-*added*-across-the-list first
 * (no save/edit timestamp exists on WorkspaceDisplay to sort by real
 * usage recency — same honest caveat as the path version).
 *
 * Dedupes by exact string equality. `excludeCommands` filters out
 * anything already present in the specific terminal entry the user is
 * currently editing, so "Recent" never suggests re-adding a command
 * that's already in that same list.
 */
export function getRecentCommands(
  workspaces: WorkspaceDisplay[],
  excludeCommands: readonly string[] = [],
  limit = 8,
): string[] {
  const commands: string[] = [];
  for (const workspace of workspaces) {
    for (const tool of workspace.tools) {
      if (tool.type !== 'terminal') continue;
      const terminals = tool.params['terminals'];
      if (!Array.isArray(terminals)) continue;
      for (const entry of terminals) {
        if (typeof entry !== 'object' || entry === null) continue;
        const entryCommands = (entry as Record<string, unknown>)['commands'];
        if (!Array.isArray(entryCommands)) continue;
        for (const raw of entryCommands) {
          if (typeof raw !== 'string') continue;
          const command = raw.trim();
          if (!command) continue;
          if (excludeCommands.includes(command)) continue;
          if (!commands.includes(command)) commands.push(command);
        }
      }
    }
  }
  return commands.slice(0, limit);
}
