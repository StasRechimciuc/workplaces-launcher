import type { WorkspaceConfig, WorkspaceStep } from '@workspace-launcher/shared';
import { getStepTypeDefinition, type StepTypeDefinition } from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../preload';

// Must match src/renderer/src/lib/tool-colors.ts's TAG_DOT_CLASSES keys
// exactly. Not centralized in @workspace-launcher/shared in this pass —
// main and renderer are separate bundles with no shared UI-constants
// module today, and touching that renderer file is outside this
// feature's scope. Flagged here as a known, small, hand-synced list.
const TAG_COLORS = ['blue', 'violet', 'amber', 'emerald', 'rose'] as const;

function tagColorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length]!;
}

function joinWithAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/**
 * Human-readable detail line + structured expand-panel rows for one
 * step, dispatched through the tool registry instead of a hand-written
 * `if (step.type === X)` chain — a 4th tool type implementing
 * `detail`/`expand` on its own registered ToolPlugin object needs zero
 * edits here (see ToolPlugin's own doc comment in
 * packages/shared/src/types.ts for the raw-params contract those
 * methods must honor).
 *
 * The `!tool` fallback chain (unregistered/unimplemented/unknown types)
 * is unaffected by which tool types happen to implement `detail`/
 * `expand` — it's keyed off STEP_TYPES via `def`, not the registry.
 */
function describeStep(
  step: WorkspaceStep,
  def: StepTypeDefinition | undefined,
): { detail: string; expand: WorkspaceToolStepDisplay['expand'] } {
  const tool = getTool(step.type);

  if (!tool) {
    if (!def) {
      return {
        detail: `Unknown step type "${step.type}" — no tool is registered for it.`,
        expand: undefined,
      };
    }
    if (!def.implemented) {
      return {
        detail: `${def.name} support isn't built yet — this step will be skipped on restore.`,
        expand: undefined,
      };
    }
    // Reachable if a Tier 1 type is flipped to implemented: true in
    // STEP_TYPES before its tool module is actually registered — a
    // wiring bug, not a normal user-facing path.
    return { detail: `Runs the ${def.name} step.`, expand: undefined };
  }

  return {
    detail: tool.detail?.(step.params) ?? `Runs the ${def?.name ?? step.type} step.`,
    expand: tool.expand?.(step.params),
  };
}

function toWorkspaceToolStepDisplay(step: WorkspaceStep): WorkspaceToolStepDisplay {
  const def = getStepTypeDefinition(step.type);
  const { detail, expand } = describeStep(step, def);
  return {
    icon: def?.icon ?? 'box',
    color: def?.color ?? 'zinc',
    name: def?.name ?? step.type,
    // No real per-step timing exists before a workspace's first
    // restore — an honest placeholder beats a fabricated number.
    time: '—',
    detail,
    // Spread conditionally, not `expand: expand`: exactOptionalPropertyTypes
    // treats an explicit `undefined` value differently from the key
    // being absent, and WorkspaceToolStepDisplay's `expand?` means "a
    // real array, or the key isn't there at all."
    ...(expand ? { expand } : {}),
    type: step.type,
    params: step.params,
  };
}

/**
 * Converts a real, persisted WorkspaceConfig into the renderer's
 * display shape. Never restored yet by definition (it was only just
 * loaded/created), so lastRestored/restoreTime are fixed, honest
 * placeholders rather than mock-style fabricated history.
 */
export function toWorkspaceDisplay(config: WorkspaceConfig): WorkspaceDisplay {
  const tools = config.steps.map(toWorkspaceToolStepDisplay);
  const stepNames = tools.map((t) => t.name);

  return {
    id: config.id,
    name: config.name,
    tag: tagColorForId(config.id),
    subtitle: `${tools.length} tool${tools.length === 1 ? '' : 's'} · never restored`,
    description:
      stepNames.length > 0
        ? `${joinWithAnd(stepNames)}, restored in order below.`
        : 'No tools added yet.',
    lastRestored: 'Never',
    restoreTime: '—',
    tools,
  };
}
