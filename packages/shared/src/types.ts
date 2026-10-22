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
  /** Stable lookup key into ERROR_CODES (error-codes.ts) — absent on success. */
  code?: string;
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

/**
 * Something this app knows how to launch/close that was left running
 * rather than touched — excluded from auto-close (Chrome), still
 * needed by another currently-active workspace, or an attempted quit
 * that actually failed (`detail` carries that failure's message — see
 * WCs/WC__workspace-activity.md). `'failed'` is never silently
 * swallowed into console-only logging: it's surfaced here so the
 * renderer can tell the user, matching this app's no-silent-failure
 * rule.
 */
export interface LeftOpenEntry {
  appName: string;
  reason: 'excluded' | 'still-used' | 'failed';
  detail?: string;
}

/**
 * Result of "Switch to this workspace" — closes whatever's running
 * that the target doesn't need, then runs the target's own steps
 * (reusing runWorkspace unchanged, since `open -a` is already
 * idempotent for anything already running).
 */
export interface SwitchResult {
  stepResults: StepResult[];
  closed: string[];
  leftOpen: LeftOpenEntry[];
}

/** Result of "Close this workspace" — closes only this workspace's own
 * apps; never opens anything. */
export interface CloseResult {
  closed: string[];
  leftOpen: LeftOpenEntry[];
}

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

/**
 * Result of setting a workspace's global hotkey (hotkeys:setBinding -
 * see WCs/WC__global-hotkeys.md). Mirrors CreateWorkspaceResult's exact
 * shape/spirit: "the combo is already in use" is routine, expected
 * input while recording, not an exceptional condition.
 */
export type SetHotkeyBindingResult =
  | { success: true }
  | { success: false; error: string; code: string };

/**
 * Result of reading the "launch at login" preference - always a live
 * read of the OS's own login-item state (settings/store.ts's
 * `launchOnLogin` field is kept in sync with this, never the other way
 * around), so it stays correct even if changed outside this app (e.g.
 * macOS System Settings > Login Items).
 */
export type GetLaunchOnLoginResult = { success: true; enabled: boolean };

/** Result of setting the "launch at login" preference. */
export type SetLaunchOnLoginResult =
  | { success: true }
  | { success: false; error: string; code: string };

/**
 * One detected step proposed for "Save my current workspace" (see
 * WCs/WC__save-current-workspace.md) — `type`/`params` are already the
 * exact WorkspaceStep shape this would save as if accepted unedited.
 * `label` is a short, human-readable summary for the review screen,
 * computed once at detection time rather than re-derived in the
 * renderer a second time. `caveat`, when present, must be shown on the
 * review screen, never silently dropped — it's how a best-effort or
 * partial detection (an idle terminal with no command, an unresolved
 * Chrome profile, a VS Code window whose folder couldn't be confirmed)
 * stays honest about what it actually found.
 */
export interface DetectedStepDraft {
  type: string;
  params: Record<string, unknown>;
  label: string;
  caveat?: string;
}

/**
 * A running, foreground app that matched no known step type and had no
 * usable path to fall back to a generic 'app' step with either (the
 * overwhelmingly rare case — virtually every real foreground app has a
 * resolvable bundle path). Shown on the review screen, never silently
 * dropped, so it's visible signal of real detection gaps rather than
 * vanishing.
 */
export interface UnmatchedRunningApp {
  name: string;
  bundlePath?: string;
}

/**
 * Result of a "Save my current workspace" detection pass.
 * `'blocked'` means a Restore/Switch/Close was already in progress when
 * detection was requested — scanning mid-transition would capture a
 * half-settled environment, so nothing was scanned at all, not a
 * partial/wrong result.
 */
export type DetectWorkspaceDraftResult =
  | { status: 'blocked' }
  | {
      status: 'ready';
      steps: DetectedStepDraft[];
      unmatched: UnmatchedRunningApp[];
      /** Detection-wide problems worth naming on the review screen —
       * e.g. "Terminal is open, but its windows couldn't be read" (a
       * systemic failure, like a missing Automation permission) — as
       * distinct from a single step's own `caveat` above. */
      issues: string[];
    };
