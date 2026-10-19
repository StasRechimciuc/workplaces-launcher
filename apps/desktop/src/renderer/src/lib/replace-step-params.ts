/**
 * Rebuilds a steps array with one step's params replaced — used by
 * Detail.tsx's inline quick-edit, since window.api.updateWorkspace
 * always overwrites the whole config (no per-step PATCH exists). Every
 * other step is passed through untouched.
 */
export function replaceStepParams<T extends { type: string; params: Record<string, unknown> }>(
  steps: T[],
  index: number,
  newParams: Record<string, unknown>,
): T[] {
  return steps.map((step, i) => (i === index ? { ...step, params: newParams } : step));
}
