import { z } from 'zod';

/**
 * A single workspace step: a tool type plus its (tool-specific) params.
 * `params` is intentionally untyped here — each tool module owns and
 * validates its own params schema (docs/architecture.md #2, Plugin-
 * Style Tool Registry). This envelope only guarantees "some tool type,
 * some params object" is present before handing off to that tool's own
 * `validate()`.
 */
export const WorkspaceStepSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
});

export type WorkspaceStep = z.infer<typeof WorkspaceStepSchema>;

/**
 * A full workspace config, as saved to disk. `version` is required from
 * day one (docs/architecture.md #3) so a future schema change can branch
 * on it and migrate, instead of silently breaking old configs.
 */
export const WorkspaceConfigSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(WorkspaceStepSchema),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export type WorkspaceConfigParseResult =
  { success: true; config: WorkspaceConfig } | { success: false; error: string };

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
