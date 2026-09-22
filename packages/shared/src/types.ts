/**
 * Result of running a single workspace step, regardless of tool type.
 * Every tool plugin's `run()` returns exactly this shape — see
 * docs/architecture.md #4 ("Standardized Step Result Shape"). Keeping
 * this identical across every tool type is what makes the retry/status
 * UI work the same way for Docker, VS Code, Chrome, etc. instead of
 * special-casing each one.
 */
export interface StepResult {
  success: boolean;
  message: string;
  durationMs: number;
}

/**
 * Discriminated on `valid` so a successful validate() carries zod's
 * already-parsed-and-defaulted output (`data`) forward — see
 * tool-validation.ts's `zodValidate` and orchestrator.ts's `runStep`,
 * which passes this `data` straight into `run()` instead of the raw,
 * un-defaulted params. No `errors` on the success variant: nothing
 * reads it outside the `!valid` branch.
 */
export type ValidationResult<TParams = unknown> =
  { valid: true; data: TParams } | { valid: false; errors: string[] };

/** One row in a step's "expand" detail panel (config/workspace-display.ts). */
export interface StepDisplayRow {
  i: string;
  label: string;
  mono: string;
}

/**
 * Context passed to a tool plugin's run(). Kept minimal and explicit
 * rather than a grab-bag "app" object, so each tool module only gets
 * what it actually needs and its dependencies stay visible in its
 * function signature.
 */
export interface RunContext {
  workspaceId: string;
}

/**
 * Shape every tool type (VS Code, Terminal, Docker, Chrome, Spotify,
 * Slack, ...) implements. See docs/architecture.md #2 — adding a new
 * tool type means adding a new module implementing this interface, not
 * editing a growing if/else or switch statement in the orchestrator.
 */
export interface ToolPlugin<TParams = unknown> {
  readonly type: string;
  validate(params: unknown): ValidationResult<TParams>;
  run(params: TParams, ctx: RunContext): Promise<StepResult>;
  /** Reserved for Tier 2 (docs/build-shell.md) — a no-op today. */
  teardown(params: TParams): Promise<StepResult>;
  /**
   * Human-readable display text for this step, shown in the sidebar/
   * detail view (config/workspace-display.ts). Optional — a type with
   * neither is shown with a generic "Runs the X step" fallback.
   *
   * Takes RAW params (`Record<string, unknown>`, exactly `step.params`
   * as saved), never validated `TParams` — this must degrade gracefully
   * for whatever's actually on disk, including a config that fails this
   * same tool's own `validate()` (loader.ts only validates the outer
   * WorkspaceConfigSchema shape, not each step's params against its
   * specific tool schema, so a hand-edited/legacy/partially-corrupted
   * file is a real, not theoretical, input here). Never throw.
   */
  detail?(params: Record<string, unknown>): string;
  /** Same raw-params contract as `detail` above. `undefined` means no expand panel. */
  expand?(params: Record<string, unknown>): StepDisplayRow[] | undefined;
}
