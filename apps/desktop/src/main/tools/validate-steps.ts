import type { WorkspaceStepInput } from '@workspace-launcher/shared';
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

/** A real validation failure, naming exactly which step and (when
 * available) which of its fields caused it — see `ValidationResult`'s
 * own doc comment for `fieldErrors`' scope/limits. `error` stays the
 * single human-readable sentence every existing caller already shows
 * verbatim in the save-error banner. */
export interface StepValidationFailure {
  error: string;
  stepIndex: number;
  fieldErrors?: Record<string, string>;
}

/**
 * Runs each step's params through its registered tool's own validate()
 * (docs/architecture.md #2) — the second, trusted-side validation layer
 * both createWorkspace and updateWorkspace need identically. A step
 * type with no registered tool yet is intentionally allowed through
 * unvalidated, same as createWorkspace always did. Returns on the
 * first failing step — an earlier step's own errors are what the user
 * sees and fixes first, not a combined report across all of them.
 */
export function validateStepsWithRegisteredTools(
  steps: readonly WorkspaceStepInput[],
): StepValidationFailure | null {
  for (const [stepIndex, step] of steps.entries()) {
    const tool = getTool(step.type);
    if (!tool) {
      continue;
    }
    const validation = tool.validate(step.params);
    if (!validation.valid) {
      return {
        error: formatInvalidParamsError(step.type, validation.errors),
        stepIndex,
        ...(validation.fieldErrors ? { fieldErrors: validation.fieldErrors } : {}),
      };
    }
  }
  return null;
}
