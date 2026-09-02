import type { StepResult } from './step-result';

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
