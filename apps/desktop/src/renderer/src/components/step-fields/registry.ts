import { VscodeFields } from './vscode-fields';
import { ChromeFields } from './chrome-fields';
import { SpotifyFields } from './spotify-fields';
import { AppFields } from './app-fields';
import { ClockifyFields } from './clockify-fields';
import { TerminalFields } from './terminal-fields';
import {
  chromeStepSummary,
  clockifyStepSummary,
  spotifyStepSummary,
  terminalStepSummary,
  vscodeStepSummary,
} from './step-summaries';
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
   * from `summary` below) vs. always shown inline with the preset's
   * static `config` hint as its subtitle. False for a type with no
   * registry entry at all (docker/terminal/slack — no registered tool
   * yet).
   */
  collapsible: boolean;
  /**
   * A one-line, live-updating summary for this type's collapsed row —
   * the whole point of collapsing a row is to still be able to tell its
   * state without expanding it, so this reads the draft's actual
   * params, not just the preset's static hint text (which is what
   * non-collapsible types show instead). Optional: a collapsible type
   * with no `summary` entry (today: 'app' — its row's own dynamic name
   * already covers this, see the comment at its entry below) falls
   * back to an empty string via `stepRowSummary` below, same as a type
   * with no registry entry at all.
   */
  summary?: (params: Record<string, unknown>) => string;
}

/**
 * Type-keyed lookup replacing WorkspaceFormModal.tsx's old
 * `if (preset.type === X)` chain in StepParamsFields — a new tool type
 * with its own fields component means adding it here, not editing that
 * component itself.
 *
 * docker/terminal/slack have no entry at all — no registered tool yet,
 * nothing a fields component could show. Clockify DOES have an entry
 * now, even though it has no tool-specific configuration beyond the
 * one thing every built-in tool type shares: which real installed app
 * it launches (see ResolvedAppPath.tsx) — previously had no entry at
 * all, back when that was its only possible field and it had nothing
 * to configure.
 */
const STEP_FIELDS: Record<string, StepFieldsRegistryEntry> = {
  vscode: {
    Component: VscodeFields,
    hasPrimaryInput: true,
    collapsible: true,
    summary: vscodeStepSummary,
  },
  chrome: {
    Component: ChromeFields,
    hasPrimaryInput: false,
    collapsible: true,
    summary: chromeStepSummary,
  },
  spotify: {
    Component: SpotifyFields,
    hasPrimaryInput: false,
    collapsible: true,
    summary: spotifyStepSummary,
  },
  // 'app' has no `summary` entry today — it's one fixed thing per
  // instance (a chosen app path), already surfaced via its row's own
  // dynamic name (WorkspaceFormModal.tsx's rowName), so a second,
  // separate one-line summary would be redundant. Falls back to an
  // empty-string subtitle via stepRowSummary below, same as a type
  // with no registry entry at all.
  app: { Component: AppFields, hasPrimaryInput: false, collapsible: true },
  clockify: {
    Component: ClockifyFields,
    hasPrimaryInput: false,
    collapsible: true,
    summary: clockifyStepSummary,
  },
  // No primary input: starts with zero terminal cards, same
  // click-Add-to-see-the-first-row precedent EditableStringList
  // already establishes for commands/URLs.
  terminal: {
    Component: TerminalFields,
    hasPrimaryInput: false,
    collapsible: true,
    summary: terminalStepSummary,
  },
};

export function getStepFieldsComponent(type: string): StepFieldsComponent | undefined {
  return STEP_FIELDS[type]?.Component;
}

/**
 * Whether `type`'s fields component registers a primary input to focus
 * — see WorkspaceFormModal.tsx's addTool/onCloseAutoFocus. False for a
 * type with no registry entry at all (docker/terminal/slack today —
 * StepParamsFields already renders nothing for them via
 * getStepFieldsComponent returning undefined), same as it is for a
 * type that has an entry but no input (Spotify, Chrome, Clockify —
 * each real content worth summarizing/hiding, none a plain <input>).
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

/**
 * A one-line, live-updating summary for `type`'s collapsed row in
 * WorkspaceFormModal — see `summary`'s own doc comment above for why
 * this reads live params rather than a static hint. Empty string for
 * any type with no `summary` entry (today: 'app', and every type with
 * no registry entry at all) — WorkspaceFormModal.tsx only calls this
 * for a collapsible row in the first place, falling back to the
 * preset's static `config` hint otherwise.
 */
export function stepRowSummary(type: string, params: Record<string, unknown>): string {
  return STEP_FIELDS[type]?.summary?.(params) ?? '';
}
