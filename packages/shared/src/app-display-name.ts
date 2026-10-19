/**
 * Derives a human-readable name from a `.app` bundle path, for display
 * only — the actual launch value always uses the full stored path, this
 * is never fed back into it. Pure string manipulation, no filesystem
 * access: "/Applications/Figma.app" -> "Figma". Shared between main
 * (tools/app-tool.ts, config/workspace-display.ts) and renderer
 * (step-fields/app-fields.tsx, WorkspaceFormModal.tsx) so there's
 * exactly one place this logic lives, not three slightly-drifting
 * copies.
 */
export function appDisplayName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.endsWith('.app') ? base.slice(0, -4) : base;
}
