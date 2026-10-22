export interface StepTypeDefinition {
  /** The step's `type` string, as stored in WorkspaceStep.type. */
  readonly type: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  /** Renderer-facing placeholder/hint text for this tool's config row. */
  readonly configHint: string;
  /**
   * Whether a real ToolPlugin is registered for this type yet (see
   * tools/index.ts's registerBuiltInTools). Drives honest "not built
   * yet" messaging (config/workspace-display.ts) instead of silently
   * pretending an unbuilt tool does something on restore.
   */
  readonly implemented: boolean;
}

/**
 * claude.md's Tier 1 "Step types to support" list, one definition per
 * type. This is the base other tool types slot into later — adding a
 * new step type means adding one entry here (plus a ToolPlugin module
 * and its registration), not editing every place that currently
 * hand-maintains icon/color/name for a tool.
 */
export const STEP_TYPES: readonly StepTypeDefinition[] = [
  {
    type: 'vscode',
    name: 'VS Code',
    icon: 'codeTwo',
    color: 'blue',
    configHint: 'Project path',
    implemented: true,
  },
  {
    type: 'docker',
    name: 'Docker',
    icon: 'box',
    color: 'sky',
    configHint: 'Containers / compose file',
    implemented: false,
  },
  {
    type: 'terminal',
    name: 'Terminal',
    icon: 'terminal',
    color: 'zinc',
    configHint: 'Commands',
    implemented: true,
  },
  {
    type: 'chrome',
    name: 'Chrome',
    icon: 'globe',
    color: 'orange',
    configHint: 'Profile + tabs',
    implemented: true,
  },
  {
    type: 'slack',
    name: 'Slack',
    icon: 'message',
    color: 'violet',
    configHint: 'Channel',
    implemented: false,
  },
  {
    type: 'spotify',
    name: 'Spotify',
    icon: 'music',
    color: 'green',
    configHint: 'Playlist',
    implemented: true,
  },
  // Not on claude.md's original Tier 1 list — added after founder
  // decision, deliberately scoped to the simplest version (launch
  // only, no target/deep-link): Clockify has no confirmed URI scheme,
  // and a bigger API-key/timer-auto-start version was researched and
  // explicitly descoped.
  {
    type: 'clockify',
    name: 'Clockify',
    icon: 'clock',
    color: 'amber',
    configHint: 'Nothing to configure',
    implemented: true,
  },
  // The non-dev-persona unlock (claude.md's working-decisions round,
  // item 4): not hardcoded to one specific app like every type above —
  // picks any installed app via a native file picker and just launches
  // it. macOS only for now; `open -a` has no Windows equivalent (see
  // app-tool.ts's own doc comment).
  {
    type: 'app',
    name: 'App',
    icon: 'appWindow',
    color: 'teal',
    configHint: 'Pick an app',
    implemented: true,
  },
  // The second of the three "wider range of users" ideas (claude.md's
  // Tier 3, pulled forward 2026-10-22): one field, auto-detects file
  // vs. link rather than asking the user to declare which upfront (see
  // WCs/WC__file-or-link.md for the full design/why). Optional "open
  // with a specific app" override reuses the App step's own picker.
  {
    type: 'link',
    name: 'File or Link',
    icon: 'externalLink',
    color: 'rose',
    configHint: 'Pick a file or paste a link',
    implemented: true,
  },
];

const STEP_TYPES_BY_TYPE: ReadonlyMap<string, StepTypeDefinition> = new Map(
  STEP_TYPES.map((def) => [def.type, def]),
);

/**
 * Returns undefined for a type not on the Tier 1 list — callers must
 * handle that gracefully (never throw), since a step's `type` is only
 * schema-validated as "a non-empty string," not restricted to this set.
 */
export function getStepTypeDefinition(type: string): StepTypeDefinition | undefined {
  return STEP_TYPES_BY_TYPE.get(type);
}
