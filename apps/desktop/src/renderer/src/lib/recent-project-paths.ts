import type { WorkspaceDisplay } from '../../../preload';

/**
 * Distinct VS Code project paths already used across the user's saved
 * workspaces, most-recently-*added*-across-the-list first (no save/
 * edit timestamp exists on WorkspaceDisplay to sort by real recency —
 * "order of appearance in listWorkspaces()'s result" is the only
 * honest ordering available, not true usage recency).
 *
 * Dedupes by exact string equality, not path normalization — a saved
 * `~`-form path and a freshly-picked absolute path to the same folder
 * can legitimately appear as two separate entries. No normalization
 * utility exists in this codebase to borrow, and inventing one is out
 * of scope for this feature.
 *
 * Includes mock/readOnly workspace paths as a source — readOnly only
 * gates mutation (edit/delete), not read-usage as a suggestion source.
 */
export function getRecentProjectPaths(
  workspaces: WorkspaceDisplay[],
  excludePath?: string,
  limit = 5,
): string[] {
  const paths: string[] = [];
  for (const workspace of workspaces) {
    for (const tool of workspace.tools) {
      if (tool.type !== 'vscode') continue;
      const raw = tool.params['path'];
      if (typeof raw !== 'string') continue;
      const path = raw.trim();
      if (!path) continue;
      if (excludePath !== undefined && path === excludePath) continue;
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths.slice(0, limit);
}
