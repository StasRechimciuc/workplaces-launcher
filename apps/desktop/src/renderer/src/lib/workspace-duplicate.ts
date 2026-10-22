import type { WorkspaceStep } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../../preload';

/**
 * Order-independent, value-based deep equality — plain JS values only
 * (what a WorkspaceStep's `params` is ever built from: strings, numbers,
 * booleans, null, arrays, and plain objects — never a Date/Map/class
 * instance), so this never needs to handle anything beyond that. Two
 * objects with the same keys in a different insertion order must still
 * compare equal (a step's params can be rebuilt from scratch — e.g. a
 * fresh detection pass vs. a previously-saved config — with no
 * guarantee the same keys land in the same order).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort();
  const bKeys = Object.keys(b as Record<string, unknown>).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Same ordered list of steps — same type, same params, in the same
 * position. Order matters here (unlike params' own key order): two
 * workspaces that run the same tools in a different sequence are a
 * real, meaningful difference (restore order), not a duplicate. */
function stepsEqual(a: WorkspaceStep[], b: WorkspaceStep[]): boolean {
  return a.length === b.length && a.every((step, i) => {
    const other = b[i];
    return other !== undefined && step.type === other.type && deepEqual(step.params, other.params);
  });
}

/**
 * Finds an already-saved workspace that's functionally identical to the
 * one about to be saved — same name (trimmed, case-insensitive) AND the
 * exact same ordered steps. Both together, deliberately: name alone
 * would false-positive on two genuinely different workspaces that just
 * happen to share a name (e.g. "Client A" torn down and rebuilt with a
 * new tool set under the same name); steps alone would false-positive
 * on two differently-named but coincidentally-identical setups. Only
 * "this literally already exists, byte for byte" should ever trigger
 * the duplicate warning — never a loose, name-only or fuzzy match that
 * would nag the user over an intentional near-duplicate.
 *
 * Returns the first match, or undefined. `excludeId` skips a workspace
 * being edited in place (comparing it against its own prior saved
 * state is never a meaningful "duplicate").
 */
export function findDuplicateWorkspace(
  candidate: { name: string; steps: WorkspaceStep[] },
  existing: WorkspaceDisplay[],
  excludeId?: string,
): WorkspaceDisplay | undefined {
  const normalizedName = candidate.name.trim().toLowerCase();
  if (!normalizedName) return undefined;
  return existing.find((ws) => {
    if (excludeId !== undefined && ws.id === excludeId) return false;
    if (ws.name.trim().toLowerCase() !== normalizedName) return false;
    const wsSteps = ws.tools.map((t) => ({ type: t.type, params: t.params }));
    return stepsEqual(wsSteps, candidate.steps);
  });
}
