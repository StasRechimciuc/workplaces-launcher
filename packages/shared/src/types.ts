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
  /**
   * Optional, per-code structured instance data — deliberately generic
   * (not named fields like `command`/`exitCode` directly on StepResult)
   * so the vast majority of tool plugins (VS Code, Chrome, Spotify,
   * Clockify, ...) that never produce this kind of detail don't carry
   * dead, always-undefined fields. A consumer narrows this by the
   * result's own `code` — e.g. for ER-TERM-01/02 (and the shared Docker
   * Tilt-engine failures, which reuse those same codes — see
   * docker-tool.ts), cast via `asTerminalFailureDetail` below. Absent
   * on every result that isn't one of those specific codes, and on
   * every result from before this field existed — a consumer must
   * treat it as optional and degrade to the plain `message` string,
   * never assume its shape from `code` alone without narrowing.
   */
  details?: Record<string, unknown>;
}

/** One configured command's outcome within a single terminal entry. */
export interface TerminalCommandResult {
  index: number;
  command: string;
  status: 'success' | 'failed' | 'not-run';
  /** Only set when `status === 'failed'`. */
  exitCode?: number;
  /** Only set when `status === 'failed'` — falls back to a generic
   * "no output captured" style string rather than ever being empty,
   * see openTerminal's own construction of this value. */
  reason?: string;
}

/**
 * One terminal window's worth of outcome — a Terminal step can have
 * several of these (one per configured terminal card); Docker's Tilt
 * branch always has exactly one, so `entries.length === 1` there. Kept
 * as a real array (not a single object) specifically because a flat,
 * single-entry shape can't represent "entry A fully succeeded, entry
 * B's second command failed" once a step has more than one terminal.
 */
export interface TerminalEntryResult {
  cwd: string;
  /**
   * Present only when NOTHING configured for this entry ever got a
   * chance to run — either the terminal app itself failed to launch,
   * or its generated script's own `cd` into `cwd` failed. Both map to
   * the same "not run" UI treatment, but keep their own distinct
   * `reason` text (see launcher.ts's openTerminal), since "Terminal.app
   * wouldn't launch" and "this directory no longer exists" point at
   * different fixes even though they look the same.
   */
  openFailed?: { stage: 'open' | 'cd'; reason: string };
  /** Empty when `openFailed` is set — nothing ran, so there's nothing
   * to list here. */
  commands: TerminalCommandResult[];
}

/** The shape `StepResult.details` carries for ER-TERM-01/ER-TERM-02
 * results (and Docker Tilt-branch failures, which reuse those same
 * codes). See `StepResult.details`'s own doc comment for why this
 * isn't a set of named fields directly on StepResult instead. */
export interface TerminalFailureDetail {
  entries: TerminalEntryResult[];
}

/**
 * Narrows `StepResult.details` to `TerminalFailureDetail` — callers
 * should only trust this for a result whose `code` is one of the
 * terminal-failure codes (ER-TERM-01/02); this function itself doesn't
 * check `code`, since it has no access to it, only to `details`. A
 * minimal structural check (an `entries` array), not a full schema
 * validation — `details` only ever comes from this app's own main
 * process, not untrusted external input, so this is a type-narrowing
 * convenience, not a security boundary.
 */
export function asTerminalFailureDetail(
  details: Record<string, unknown> | undefined,
): TerminalFailureDetail | undefined {
  if (!details || !Array.isArray(details['entries'])) return undefined;
  return details as unknown as TerminalFailureDetail;
}

/**
 * Discriminated on `valid` so a successful validate() carries zod's
 * already-parsed-and-defaulted output (`data`) forward — see
 * tool-validation.ts's `zodValidate` and orchestrator.ts's `runStep`,
 * which passes this `data` straight into `run()` instead of the raw,
 * un-defaulted params. No `errors` on the success variant: nothing
 * reads it outside the `!valid` branch.
 *
 * `fieldErrors` is an optional, additive projection of the same
 * failures onto a plain `{ fieldName: message }` map (first zod issue
 * per top-level field — a nested path like `terminals[0].cwd` collapses
 * to the `terminals` key, not torn down to row granularity) — enough
 * for a renderer to highlight which field actually failed, without
 * every tool's own validate() needing to build it by hand. Absent, not
 * an empty object, when no issue has a path at all (e.g. a whole-object
 * `.superRefine` with no `path`) — see zodValidate's own doc comment.
 */
export type ValidationResult<TParams = unknown> =
  | { valid: true; data: TParams }
  | { valid: false; errors: string[]; fieldErrors?: Record<string, string> };

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
/**
 * One thing a step opens that per-resource tracking follows (see
 * WCs/WC__window-tracking.md, "The model"): which resource kind
 * handles it, and the identity that makes two of them "the same" — a
 * step whose spec matches a live resource reuses it rather than
 * opening a second copy.
 */
export interface ResourceSpec {
  /** A registered resource kind ('app', …) — main/resources/kind-registry.ts. */
  kind: string;
  /** Kind-specific identity fields, e.g. `{ bundleId }`; serialized into the ledger's identity key. */
  identity: Record<string, string | number | boolean>;
  /** Shown in Close/Switch results, e.g. "Spotify". */
  label: string;
}

export interface ToolPlugin<TParams = unknown> {
  readonly type: string;
  validate(params: unknown): ValidationResult<TParams>;
  run(params: TParams, ctx: RunContext): Promise<StepResult>;
  /**
   * The resources this step opens, for per-resource tracking. Optional:
   * a step type without it isn't tracked and keeps the app-level
   * Close/Switch behavior. Never throws — a spec that can't be worked
   * out (e.g. an app whose bundle can't be read) is left out and the
   * reason logged, so the step still runs, just untracked.
   */
  resources?(params: TParams): Promise<ResourceSpec[]>;
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
  { success: true } | { success: false; error: string; code: string };

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
  { success: true } | { success: false; error: string; code: string };

/**
 * Whether this app can use macOS Accessibility — the one permission
 * per-window tracking needs (see WCs/WC__window-tracking.md,
 * "Permissions"). Always a fresh read through a newly spawned
 * `wl-helper trust`, never a cached flag: a long-running process can
 * keep reporting a stale grant after the app is removed from the list.
 *
 * - 'unsupported': not macOS — nothing to ask for, no UI shown.
 * - 'granted': full mode.
 * - 'not-granted': reduced mode. `onboardingCompleted` is true once the
 *   first-launch explanation was either completed or skipped with
 *   "Continue without", so it's never forced on the user twice — from
 *   then on the banner and the Settings row offer the same flow.
 * - 'helper-unavailable': the native helper is missing or broken, so
 *   granting the permission wouldn't help — reduced mode with the
 *   explicit error, not a misleading "grant access" prompt.
 */
export type AccessibilityStatus =
  | { state: 'unsupported' }
  | { state: 'granted' }
  | { state: 'not-granted'; onboardingCompleted: boolean; code: string }
  | { state: 'helper-unavailable'; error: string; code: string };

/** Result of opening System Settings at Privacy & Security → Accessibility. */
export type OpenAccessibilitySettingsResult =
  { success: true } | { success: false; error: string; code: string };

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
