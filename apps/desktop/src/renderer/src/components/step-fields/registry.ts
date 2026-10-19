import { VscodeFields } from './vscode-fields';
import { ChromeFields } from './chrome-fields';
import { SpotifyFields } from './spotify-fields';
import { AppFields } from './app-fields';
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
   * focus (their UI is entirely buttons/a picker).
   */
  hasPrimaryInput: boolean;
  /**
   * Whether this type's row in WorkspaceFormModal.tsx's Tools list is
   * collapsible (chevron, click-to-expand/collapse, a dynamic subtitle
   * from step-row-summary.ts) vs. always shown inline with the preset's
   * static `config` hint as its subtitle. False for a type with no
   * registry entry at all (Clockify included — see the comment above
   * STEP_FIELDS).
   */
  collapsible: boolean;
}

/**
 * Type-keyed lookup replacing WorkspaceFormModal.tsx's old
 * `if (preset.type === X)` chain in StepParamsFields — a new tool type
 * with its own fields component means adding it here, not editing that
 * component itself.
 */
// Clockify has no entry here at all — same as docker/terminal/slack
// (no registered tool yet) — because it genuinely has nothing to
// configure, so there's nothing a fields component could ever show.
// Its one-line explanation lives in STEP_TYPES' configHint instead,
// shown as the Tools-list row's header subtitle — not a dedicated
// component. `implemented: true` (STEP_TYPES) still distinguishes it
// from docker/terminal/slack's "not built yet."
const STEP_FIELDS: Record<string, StepFieldsRegistryEntry> = {
  vscode: { Component: VscodeFields, hasPrimaryInput: true, collapsible: true },
  chrome: { Component: ChromeFields, hasPrimaryInput: false, collapsible: true },
  spotify: { Component: SpotifyFields, hasPrimaryInput: false, collapsible: true },
  app: { Component: AppFields, hasPrimaryInput: false, collapsible: true },
};

export function getStepFieldsComponent(type: string): StepFieldsComponent | undefined {
  return STEP_FIELDS[type]?.Component;
}

/**
 * Whether `type`'s fields component registers a primary input to focus
 * — see WorkspaceFormModal.tsx's addTool/onCloseAutoFocus. False for a
 * type with no registry entry at all (Docker/Terminal/Slack/Clockify
 * today — StepParamsFields already renders nothing for them via
 * getStepFieldsComponent returning undefined), same as it is for a
 * type that has an entry but no input (Spotify, Chrome).
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
