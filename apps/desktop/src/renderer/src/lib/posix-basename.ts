/**
 * Extracts a POSIX path's final segment — e.g. '/Users/stas/my-app/' ->
 * 'my-app'. No `node:path` available in the renderer (contextIsolation
 * /sandboxed — see preload/index.ts's own notes), so this is a plain
 * string op, POSIX `/` only (this app is macOS-only for now — see
 * claude.md's platform roadmap). Trailing slash(es) are stripped first
 * — otherwise `.split('/').pop()` would return '' for a path like
 * '/Users/stas/my-app/', silently discarding a perfectly good basename.
 */
export function posixBasename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? '';
}
