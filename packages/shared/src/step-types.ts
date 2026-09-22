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
    implemented: false,
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
