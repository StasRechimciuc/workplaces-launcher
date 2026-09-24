import { VscodeFields } from './vscode-fields';
import { ChromeFields } from './chrome-fields';
import { SpotifyFields } from './spotify-fields';
import { ClockifyFields } from './clockify-fields';
import type { StepFieldsComponent } from './types';

interface StepFieldsRegistryEntry {
  Component: StepFieldsComponent;
  /**
   * Whether this type's fields component ever calls
   * registerPrimaryInputRef (StepFieldsProps' own doc comment) — i.e.
   * whether there's a real input for WorkspaceFormModal.tsx's
   * pendingFocusKeyRef effect to focus after this type is picked from
   * the Add-tool dropdown. Explicit per entry, not inferred from
   * STEP_TYPES' `implemented` flag: those are different facts that
   * happened to coincide for every type built so far (vscode/chrome/
   * spotify all render an input) until Clockify — implemented, but
   * with nothing to focus.
   */
  hasPrimaryInput: boolean;
}

/**
 * Type-keyed lookup replacing WorkspaceFormModal.tsx's old
 * `if (preset.type === X)` chain in StepParamsFields — a new tool type
 * with its own fields component means adding it here, not editing that
 * component itself.
 */
const STEP_FIELDS: Record<string, StepFieldsRegistryEntry> = {
  vscode: { Component: VscodeFields, hasPrimaryInput: true },
  chrome: { Component: ChromeFields, hasPrimaryInput: true },
  spotify: { Component: SpotifyFields, hasPrimaryInput: true },
  clockify: { Component: ClockifyFields, hasPrimaryInput: false },
};

export function getStepFieldsComponent(type: string): StepFieldsComponent | undefined {
  return STEP_FIELDS[type]?.Component;
}

/**
 * Whether `type`'s fields component registers a primary input to focus
 * — see WorkspaceFormModal.tsx's addTool/onCloseAutoFocus. False for a
 * type with no registry entry at all (Docker/Terminal/Slack today —
 * StepParamsFields already renders nothing for them via
 * getStepFieldsComponent returning undefined), same as it is for a
 * type that has an entry but no input (Clockify).
 */
export function stepFieldsHasPrimaryInput(type: string): boolean {
  return STEP_FIELDS[type]?.hasPrimaryInput ?? false;
}
