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
   * the Add-tool dropdown. Independent of `collapsible` below —
   * spotify and chrome are both collapsible (real, state-dependent
   * content worth summarizing/hiding) but have no plain <input> to
   * focus (their UI is entirely buttons/a picker), which Clockify's
   * "neither collapsible nor has an input" case didn't need to
   * distinguish until now.
   */
  hasPrimaryInput: boolean;
  /**
   * Whether this type's row in WorkspaceFormModal.tsx's Tools list is
   * collapsible (chevron, click-to-expand/collapse, a dynamic subtitle
   * from step-row-summary.ts) vs. always shown inline with the preset's
   * static `config` hint as its subtitle. False for a type with
   * genuinely nothing to configure (Clockify).
   */
  collapsible: boolean;
}

/**
 * Type-keyed lookup replacing WorkspaceFormModal.tsx's old
 * `if (preset.type === X)` chain in StepParamsFields — a new tool type
 * with its own fields component means adding it here, not editing that
 * component itself.
 */
const STEP_FIELDS: Record<string, StepFieldsRegistryEntry> = {
  vscode: { Component: VscodeFields, hasPrimaryInput: true, collapsible: true },
  chrome: { Component: ChromeFields, hasPrimaryInput: false, collapsible: true },
  spotify: { Component: SpotifyFields, hasPrimaryInput: false, collapsible: true },
  clockify: { Component: ClockifyFields, hasPrimaryInput: false, collapsible: false },
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
 * type that has an entry but no input (Clockify, Spotify).
 */
export function stepFieldsHasPrimaryInput(type: string): boolean {
  return STEP_FIELDS[type]?.hasPrimaryInput ?? false;
}

/**
 * Whether `type`'s row should render collapsed/expandable — see
 * WorkspaceFormModal.tsx's `collapsible` derivation and addTool's
 * auto-expand-on-add logic. False for a type with no registry entry at
 * all, same as stepFieldsHasPrimaryInput.
 */
export function stepFieldsIsCollapsible(type: string): boolean {
  return STEP_FIELDS[type]?.collapsible ?? false;
}
