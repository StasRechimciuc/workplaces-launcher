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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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
  validate(params: unknown): ValidationResult;
  run(params: TParams, ctx: RunContext): Promise<StepResult>;
  /** Reserved for Tier 2 (docs/build-shell.md) — a no-op today. */
  teardown(params: TParams): Promise<StepResult>;
}
