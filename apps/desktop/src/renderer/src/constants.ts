// Presentation data. Color lookups live in lib/tool-colors.ts (as
// Tailwind class names, backed by styles.css's @theme).
import { STEP_TYPES } from '@workspace-launcher/shared';

export interface CreateToolPreset {
  /** The real step type this preset saves as (WorkspaceStep.type). */
  type: string;
  icon: string;
  color: string;
  name: string;
  config: string;
  /**
   * Whether a real ToolPlugin is registered for this type yet
   * (STEP_TYPES' own field — packages/shared/src/step-types.ts).
   * Drives the "Soon" badge in the Add-tool picker; never blocks
   * adding one, matching this app's existing "honest, not blocking"
   * convention (an unbuilt type already saves fine and fails
   * honestly on restore — config/workspace-display.ts).
   */
  implemented: boolean;
}

/**
 * Presets shown in the "New workspace" modal's tool list — one row per
 * Tier 1 step type, derived from @workspace-launcher/shared's
 * STEP_TYPES so icon/color/name/type/implemented stay in sync with the
 * single source of truth src/main/config/workspace-display.ts also
 * reads from, instead of two hand-maintained copies drifting apart.
 * `config` is purely renderer-facing placeholder copy for the modal's
 * UI (STEP_TYPES' configHint, reused verbatim).
 */
export const CREATE_TOOL_PRESETS: CreateToolPreset[] = STEP_TYPES.map((def) => ({
  type: def.type,
  icon: def.icon,
  color: def.color,
  name: def.name,
  config: def.configHint,
  implemented: def.implemented,
}));
