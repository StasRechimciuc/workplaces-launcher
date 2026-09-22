/**
 * Decides which workspace id should be active after the sidebar list
 * reloads. Extracted out of App.tsx's refreshWorkspaces so this
 * fallback logic — pure list/id lookup, no DOM/state dependency — has
 * a real regression test, same precedent as vscode-terminal-params.ts.
 *
 * The bug this fixes: if the previously-active (or just-deleted)
 * workspace no longer exists in the freshly-loaded list, staying
 * pointed at its id leaves Detail unable to find a matching workspace
 * to render. Falls back to the first workspace in the list, or '' if
 * the list is itself empty.
 */
export function resolveActiveWorkspaceId(loaded: { id: string }[], target: string): string {
  const stillExists = loaded.some((ws) => ws.id === target);
  return stillExists ? target : (loaded[0]?.id ?? '');
}
