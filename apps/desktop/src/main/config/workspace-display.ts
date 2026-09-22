import type { WorkspaceConfig, WorkspaceStep } from '@workspace-launcher/shared';
import { getStepTypeDefinition, type StepTypeDefinition } from '@workspace-launcher/shared';
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

function detailForStep(step: WorkspaceStep, def: StepTypeDefinition | undefined): string {
  if (step.type === 'vscode') {
    const path = typeof step.params['path'] === 'string' ? step.params['path'] : undefined;
    return path ? `Opens ${path}` : 'Opens the configured folder path.';
  }
  if (step.type === 'chrome') {
    const profile = typeof step.params['profile'] === 'string' ? step.params['profile'] : undefined;
    const urls = Array.isArray(step.params['urls'])
      ? step.params['urls'].filter((u): u is string => typeof u === 'string')
      : [];
    if (!profile) {
      return 'Opens Chrome — no profile configured yet.';
    }
    if (urls.length === 0) {
      return `Opens Chrome (profile: ${profile}).`;
    }
    return `Opens ${urls.length} tab${urls.length === 1 ? '' : 's'} in Chrome (profile: ${profile}).`;
  }
  if (step.type === 'spotify') {
    const playlist =
      typeof step.params['playlist'] === 'string' && step.params['playlist'].length > 0
        ? step.params['playlist']
        : undefined;
    return playlist ? `Opens ${playlist} in Spotify.` : 'Opens Spotify.';
  }
  if (!def) {
    return `Unknown step type "${step.type}" — no tool is registered for it.`;
  }
  if (!def.implemented) {
    return `${def.name} support isn't built yet — this step will be skipped on restore.`;
  }
  // Reachable once a fourth Tier 1 type ships without a bespoke detail
  // line added above — flags the gap instead of silently going stale.
  return `Runs the ${def.name} step.`;
}

/**
 * Structured rows for a step's expandable detail panel
 * (TimelineStep.tsx) — the mock data's old `expand` arrays had these
 * (e.g. a "Path" row with the folder mono'd out); real persisted
 * configs need the same treatment or the panel renders as an empty,
 * confusing box. Returns undefined (not an empty array) when there's
 * nothing structured to show — TimelineStep.tsx only renders the
 * expand toggle at all when this is present and non-empty, so an
 * unbuilt/unconfigured step's detail text (already honest on its own)
 * doesn't get a dead expand affordance next to it.
 */
function expandForStep(step: WorkspaceStep): WorkspaceToolStepDisplay['expand'] {
  if (step.type === 'vscode') {
    const path = typeof step.params['path'] === 'string' ? step.params['path'] : undefined;
    return path ? [{ i: 'folder', label: 'Path', mono: path }] : undefined;
  }
  if (step.type === 'chrome') {
    const profile = typeof step.params['profile'] === 'string' ? step.params['profile'] : undefined;
    if (!profile) {
      return undefined;
    }
    const urls = Array.isArray(step.params['urls'])
      ? step.params['urls'].filter((u): u is string => typeof u === 'string')
      : [];
    return [
      { i: 'globe', label: 'Profile', mono: profile },
      ...urls.map((url) => ({ i: 'check', label: 'Tab', mono: url })),
    ];
  }
  if (step.type === 'spotify') {
    const playlist =
      typeof step.params['playlist'] === 'string' && step.params['playlist'].length > 0
        ? step.params['playlist']
        : undefined;
    return playlist ? [{ i: 'music', label: 'Playlist', mono: playlist }] : undefined;
  }
  // Unbuilt or unknown types have nothing structured to show —
  // detailForStep's own text already covers it.
  return undefined;
}

function toWorkspaceToolStepDisplay(step: WorkspaceStep): WorkspaceToolStepDisplay {
  const def = getStepTypeDefinition(step.type);
  const expand = expandForStep(step);
  return {
    icon: def?.icon ?? 'box',
    color: def?.color ?? 'zinc',
    name: def?.name ?? step.type,
    // No real per-step timing exists before a workspace's first
    // restore — an honest placeholder beats a fabricated number.
    time: '—',
    detail: detailForStep(step, def),
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
