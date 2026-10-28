import { z } from 'zod';

/**
 * The current on-disk workspace config version. Every config-building
 * call site (ipc/handlers.ts's restoreWorkspace and createWorkspace)
 * uses this instead of repeating the literal `1`, so a future version
 * bump (Tier 2 migration, docs/architecture.md #3) means changing this
 * one value plus adding explicit migration logic — not hunting down
 * every hardcoded `1` across the codebase.
 */
export const CURRENT_WORKSPACE_CONFIG_VERSION = 2 as const;

/**
 * A step's stable id — what per-resource tracking (WCs/
 * WC__window-tracking.md, Stage 2 plan section 3) keys a step's
 * windows and processes by, so they stay attached to the right step
 * when steps are added, removed or reordered. An array index can't do
 * that. Assigned once by the main process (newStepId) and never
 * changed afterwards; the renderer only ever echoes back ids it was
 * given. Same safe-token charset as the workspace id below.
 */
export const StepIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'step id must be 1-64 letters, numbers, hyphens or underscores');

/** A fresh step id. Web Crypto's randomUUID exists in Node 20+ and every renderer. */
export function newStepId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A single workspace step: a tool type plus its (tool-specific) params.
 * `params` is intentionally untyped here — each tool module owns and
 * validates its own params schema (docs/architecture.md #2, Plugin-
 * Style Tool Registry). This envelope only guarantees "some tool type,
 * some params object" is present before handing off to that tool's own
 * `validate()`.
 */
export const WorkspaceStepSchema = z.object({
  id: StepIdSchema,
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

export type WorkspaceStep = z.infer<typeof WorkspaceStepSchema>;

/**
 * A step as the renderer sends it on create/update: `id` present for a
 * step that already exists (kept as-is), absent for one added in this
 * edit (assigned by assignStepIds). Never generated renderer-side, so
 * there's exactly one place ids come from.
 */
export type WorkspaceStepInput = Omit<WorkspaceStep, 'id'> & { id?: string };

/**
 * Fills in an id for every step that has none (a step added in this
 * edit); a present id passes through untouched, even a malformed or
 * duplicated one — rejecting those is parseWorkspaceConfig's job, run
 * on the result. Takes `unknown` because its input is the renderer's
 * untrusted IPC payload, before any validation.
 */
export function assignStepIds(steps: unknown): unknown {
  if (!Array.isArray(steps)) return steps;
  return steps.map((step: unknown) =>
    typeof step === 'object' && step !== null && !('id' in step)
      ? { ...step, id: newStepId() }
      : step,
  );
}

/**
 * A full workspace config, as saved to disk. `version` is required from
 * day one (docs/architecture.md #3) so a future schema change can branch
 * on it and migrate, instead of silently breaking old configs.
 */
export const WorkspaceConfigSchema = z.object({
  version: z.literal(CURRENT_WORKSPACE_CONFIG_VERSION),
  // Restricted to a safe filename-token charset (letters, digits,
  // hyphens, underscores — randomUUID() output stays well within this)
  // because config/loader.ts uses `id` directly as `<id>.json` when
  // reading/writing/deleting on disk. Today createWorkspace always
  // generates `id` itself via randomUUID(), so this isn't reachable
  // through the app's own IPC surface — but a hand-placed or
  // future-imported config file isn't bound by that, and an id like
  // "../../../Library/LaunchAgents/evil" would otherwise let a save or
  // delete escape the intended workspaces directory. Defense in depth,
  // enforced once here rather than at every call site.
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/, 'id must contain only letters, numbers, hyphens, and underscores'),
  name: z.string().min(1),
  steps: z.array(WorkspaceStepSchema).superRefine((steps, ctx) => {
    // Unique within a workspace: a duplicated id would make two steps
    // claim the same tracked resources.
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `Duplicate step id "${step.id}"`,
        });
      }
      seen.add(step.id);
    });
  }),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export type WorkspaceConfigParseResult =
  { success: true; config: WorkspaceConfig } | { success: false; error: string };

/**
 * Upgrades an older on-disk config to the current shape, without
 * validating anything else — parseWorkspaceConfig does that next, on
 * the result. Returns the input untouched (`migrated: false`) when
 * there's nothing to upgrade or it isn't recognizably a config at all,
 * leaving the rejection to the parser's normal error path.
 *
 * - v1 → v2: every step gets a stable id (StepIdSchema).
 *
 * The caller must persist a migrated config before relying on it
 * (config/loader.ts writes it straight back): a v1 file migrated
 * in memory only would get different step ids on every load.
 */
export function migrateWorkspaceConfig(input: unknown): { migrated: boolean; value: unknown } {
  if (typeof input !== 'object' || input === null) {
    return { migrated: false, value: input };
  }
  const config = input as Record<string, unknown>;
  if (config.version !== 1 || !Array.isArray(config.steps)) {
    return { migrated: false, value: input };
  }
  return {
    migrated: true,
    value: {
      ...config,
      version: 2,
      steps: config.steps.map((step: unknown) =>
        typeof step === 'object' && step !== null ? { ...step, id: newStepId() } : step,
      ),
    },
  };
}

/**
 * Parses and validates untrusted input (a workspace config read from
 * disk) into a WorkspaceConfig. Never throws — config files are
 * untrusted input that gets shelled out against downstream, so a
 * malformed or malicious file must fail loudly and safely here, not
 * crash the app or silently coerce into something unintended.
 */
export function parseWorkspaceConfig(input: unknown): WorkspaceConfigParseResult {
  const result = WorkspaceConfigSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true, config: result.data };
}

/**
 * What the renderer sends to create a new workspace. `id` and `version`
 * are deliberately excluded — they're generated by the main process
 * (see ipc/handlers.ts's createWorkspace), never user input, so there's
 * no way for a caller to supply a wrong or colliding one.
 */
export interface CreateWorkspaceInput {
  name: string;
  steps: WorkspaceStepInput[];
}

/**
 * Mirrors WorkspaceConfigParseResult's shape/spirit: a flat,
 * discriminated success/failure result instead of a thrown exception,
 * because "the user left a required field empty" is routine input
 * during normal use of the Save button, not an exceptional condition.
 */
/**
 * `stepIndex`/`fieldErrors` are only ever present for a step-validation
 * failure (validate-steps.ts's StepValidationFailure) — a structural
 * failure (parseWorkspaceConfig) or an unrelated one (e.g.
 * WORKSPACE_NOT_FOUND) carries neither, since there's no specific step/
 * field to point at.
 */
export type CreateWorkspaceResult =
  | { success: true; config: WorkspaceConfig }
  | {
      success: false;
      error: string;
      code: string;
      stepIndex?: number;
      fieldErrors?: Record<string, string>;
    };

/**
 * What the renderer sends to update an existing workspace. Unlike
 * CreateWorkspaceInput, `id` is required — it identifies which saved
 * config to overwrite (ipc/handlers.ts's updateWorkspace, via
 * config/loader.ts's saveWorkspaceConfig — already an overwrite-by-id
 * primitive, unchanged by this feature). `version` stays excluded and
 * server-regenerated, same reasoning as CreateWorkspaceInput.
 */
export interface UpdateWorkspaceInput {
  id: string;
  name: string;
  steps: WorkspaceStepInput[];
}

/** Mirrors CreateWorkspaceResult's exact shape/spirit, `stepIndex`/
 * `fieldErrors` included. */
export type UpdateWorkspaceResult =
  | { success: true; config: WorkspaceConfig }
  | {
      success: false;
      error: string;
      code: string;
      stepIndex?: number;
      fieldErrors?: Record<string, string>;
    };

/**
 * Mirrors CreateWorkspaceResult/UpdateWorkspaceResult's shape, minus a
 * payload — a successful delete has nothing further to hand back
 * beyond "it's gone."
 */
export type DeleteWorkspaceResult =
  { success: true } | { success: false; error: string; code: string };
