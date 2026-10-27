import type { WorkspaceConfig, WorkspaceStep } from '@workspace-launcher/shared';
import {
  appDisplayName,
  formatDuration,
  getStepTypeDefinition,
  type StepTypeDefinition,
} from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import { getTypicalStepDurationMs } from '../orchestrator/step-timing-history';
import type { TimingDisplay, WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../preload';

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

/**
 * The generic 'app' type's whole point is that it isn't one fixed
 * thing — showing the literal STEP_TYPES name ("App") for every single
 * instance would be useless/confusing with more than one in the same
 * workspace (which app?). Every other type's name is genuinely static
 * (a "VS Code" step is always VS Code), so this is deliberately scoped
 * to 'app' only, not a general per-type override mechanism.
 */
function stepDisplayName(step: WorkspaceStep, def: StepTypeDefinition | undefined): string {
  if (step.type === 'app') {
    const path = step.params['path'];
    if (typeof path === 'string' && path.length > 0) {
      return appDisplayName(path);
    }
  }
  return def?.name ?? step.type;
}

/**
 * This step type's typical launch time, for display — "launch," not
 * "restore"/"ready": on macOS this reflects real, measured time until
 * the app's process was detected running (orchestrator.ts's runStep),
 * on top of the tool's own launch-call duration; some apps may still be
 * finishing their own startup after this point (true idle/readiness
 * detection is out of scope — see WCs/WC__project-status.md). 'unmeasured'
 * below MIN_SAMPLES_FOR_ADAPTIVE_TIMEOUT samples (step-timing-history.ts)
 * — not a guess, an honest "no data yet."
 */
function stepLaunchTime(stepType: string, stepParams: Record<string, unknown>): TimingDisplay {
  const typicalMs = getTypicalStepDurationMs(stepType, stepParams);
  if (typicalMs === undefined) {
    return { display: 'Not yet measured', state: 'unmeasured' };
  }
  return { display: `~${formatDuration(typicalMs)}`, state: 'full' };
}

/**
 * Workspace-level launch-time summary: sums each step's typical
 * duration, but only across steps that actually have data — a step
 * with no history yet is never silently counted as 0ms, which would
 * understate the real total. Four distinct outcomes: zero steps ('—' —
 * nothing to time at all, distinct from "has steps but none measured
 * yet"); steps exist but none have data ('unmeasured'); some but not
 * all have data ('partial' — the real total is at least this much,
 * never a falsely-clean number); every step has data ('full').
 */
function workspaceLaunchTime(steps: WorkspaceStep[]): TimingDisplay {
  if (steps.length === 0) {
    return { display: '—', state: 'no-steps' };
  }

  const durations = steps.map((step) => getTypicalStepDurationMs(step.type, step.params));
  const known = durations.filter((ms): ms is number => ms !== undefined);

  if (known.length === 0) {
    return { display: 'Not yet measured', state: 'unmeasured' };
  }

  const sum = known.reduce((total, ms) => total + ms, 0);
  const formatted = `~${formatDuration(sum)}`;
  if (known.length === durations.length) {
    return { display: formatted, state: 'full' };
  }
  return {
    display: `${formatted} · ${known.length}/${durations.length} steps timed`,
    state: 'partial',
  };
}

function toWorkspaceToolStepDisplay(step: WorkspaceStep): WorkspaceToolStepDisplay {
  const def = getStepTypeDefinition(step.type);
  const { detail, expand } = describeStep(step, def);
  return {
    icon: def?.icon ?? 'box',
    color: def?.color ?? 'zinc',
    name: stepDisplayName(step, def),
    launchTime: stepLaunchTime(step.type, step.params),
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
 * display shape.
 */
export function toWorkspaceDisplay(config: WorkspaceConfig): WorkspaceDisplay {
  const tools = config.steps.map(toWorkspaceToolStepDisplay);
  const stepNames = tools.map((t) => t.name);

  return {
    id: config.id,
    name: config.name,
    tag: tagColorForId(config.id),
    subtitle: `${tools.length} tool${tools.length === 1 ? '' : 's'}`,
    description:
      stepNames.length > 0
        ? `${joinWithAnd(stepNames)}, restored in order below.`
        : 'No tools added yet.',
    launchTime: workspaceLaunchTime(config.steps),
    tools,
  };
}
