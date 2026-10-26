/**
 * Suggests reusing a project-path value already set on ANOTHER step in
 * the current (in-progress, unsaved) workspace draft — VS Code's
 * `path`, Docker's `directory`, or a standalone Terminal step's first
 * entry's `cwd`. These three fields are the only ones this applies to
 * (deliberately NOT a generic cross-field framework — Chrome/Spotify/
 * App/Link don't represent "a project directory" at all, so suggesting
 * across them would be a wrong guess, not a convenience).
 *
 * Click-to-accept only (see WorkspaceFormModal.tsx/docker-fields.tsx
 * etc. for the suggestion-chip UI) — never silently applied. A real
 * multi-repo case exists where VS Code's path and a Compose project's
 * directory legitimately differ, so a wrong silent guess would go
 * unnoticed; a clickable chip the user actively confirms doesn't have
 * that risk.
 */

export interface ProjectPathSuggestion {
  sourceLabel: string;
  path: string;
}

const SOURCE_LABELS: Record<string, string> = {
  vscode: 'VS Code',
  docker: 'Docker',
  terminal: 'Terminal',
};

function pathFromStep(type: string, params: Record<string, unknown>): string | undefined {
  if (type === 'vscode' || type === 'docker') {
    const key = type === 'vscode' ? 'path' : 'directory';
    const value = params[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
  if (type === 'terminal') {
    const terminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
    const first = terminals[0];
    if (typeof first !== 'object' || first === null) return undefined;
    const cwd = (first as Record<string, unknown>)['cwd'];
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
  }
  return undefined;
}

/**
 * The first real project-path value set on any OTHER step in the
 * draft, in array order (not weighted by step type — whichever was
 * filled in first, regardless of which of the three types it is, wins).
 * `excludeKey` is always the row asking — a field never suggests its
 * own current value to itself. Returns undefined when none of the
 * three fields has a value anywhere else in the draft.
 */
export function getProjectPathSuggestion(
  steps: { key: number; type: string; params: Record<string, unknown> }[],
  excludeKey: number,
): ProjectPathSuggestion | undefined {
  for (const step of steps) {
    if (step.key === excludeKey) continue;
    const path = pathFromStep(step.type, step.params);
    if (path) {
      return { sourceLabel: SOURCE_LABELS[step.type] ?? step.type, path };
    }
  }
  return undefined;
}
