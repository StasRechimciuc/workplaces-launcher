import type { WorkspaceStep } from '@workspace-launcher/shared';
import { getTool } from './registry';

/**
 * The one error-string template both orchestrator.ts (restore-time
 * validation) and validateStepsWithRegisteredTools below (save-time
 * validation) need identically — previously hand-copied into both
 * files, drifting apart was a real risk the moment either needed to
 * change (e.g. to include a step index for multi-step errors).
 */
export function formatInvalidParamsError(type: string, errors: string[]): string {
  return `Invalid params for step type "${type}": ${errors.join(', ')}`;
}

/**
 * Runs each step's params through its registered tool's own validate()
 * (docs/architecture.md #2) — the second, trusted-side validation layer
 * both createWorkspace and updateWorkspace need identically. A step
 * type with no registered tool yet is intentionally allowed through
 * unvalidated, same as createWorkspace always did.
 */
export function validateStepsWithRegisteredTools(steps: WorkspaceStep[]): string | null {
  for (const step of steps) {
    const tool = getTool(step.type);
    if (!tool) {
      continue;
    }
    const validation = tool.validate(step.params);
    if (!validation.valid) {
      return formatInvalidParamsError(step.type, validation.errors);
    }
  }
  return null;
}
