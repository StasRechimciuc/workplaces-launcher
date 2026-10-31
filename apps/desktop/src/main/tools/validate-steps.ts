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

/**
 * Drops the blank rows a form leaves behind — an empty "URL" or
 * "command" input the user added but never filled in. A blank row is an
 * unused input, not a mistake to reject the whole save over. Raw,
 * untrusted input (it comes over IPC): anything not shaped as expected
 * is passed through untouched for validation to judge.
 */
export function withoutBlankRows(steps: unknown): unknown {
  if (!Array.isArray(steps)) return steps;
  return steps.map((step: unknown) => {
    if (typeof step !== 'object' || step === null) return step;
    const { type, params } = step as { type?: unknown; params?: unknown };
    if (typeof params !== 'object' || params === null) return step;
    const p = params as Record<string, unknown>;
    if (type === 'chrome' && Array.isArray(p['urls'])) {
      return { ...step, params: { ...p, urls: withoutBlanks(p['urls']) } };
    }
    if (type === 'terminal' && Array.isArray(p['terminals'])) {
      const terminals = p['terminals'].map((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        Array.isArray((entry as { commands?: unknown }).commands)
          ? { ...entry, commands: withoutBlanks((entry as { commands: unknown[] }).commands) }
          : entry,
      );
      return { ...step, params: { ...p, terminals } };
    }
    return step;
  });
}

function withoutBlanks(values: unknown[]): unknown[] {
  return values.filter((v) => typeof v !== 'string' || v.trim() !== '');
}
