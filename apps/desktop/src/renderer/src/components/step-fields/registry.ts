import { VscodeFields } from './vscode-fields';
import { ChromeFields } from './chrome-fields';
import { SpotifyFields } from './spotify-fields';
import type { StepFieldsComponent } from './types';

/**
 * Type-keyed lookup replacing WorkspaceFormModal.tsx's old
 * `if (preset.type === X)` chain in StepParamsFields — a new tool type
 * with its own fields component means adding it here, not editing that
 * component itself.
 */
const STEP_FIELDS: Record<string, StepFieldsComponent> = {
  vscode: VscodeFields,
  chrome: ChromeFields,
  spotify: SpotifyFields,
};

export function getStepFieldsComponent(type: string): StepFieldsComponent | undefined {
  return STEP_FIELDS[type];
}
