import { z } from 'zod';
import type { StepResult, ToolPlugin, ValidationResult } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { expandHome } from '../lib/paths';

/**
 * Params schema for a "vscode" step: open a folder path in VS Code
 * (docs/build-shell.md, "VS Code — open folder path"). Lives alongside
 * this tool module, not in packages/shared — the shared package only
 * defines the generic step envelope (docs/architecture.md #2), each
 * tool owns its own params shape.
 */
const VSCodeStepParamsSchema = z.object({
  path: z.string().min(1, 'path must be a non-empty string'),
});

export type VSCodeStepParams = z.infer<typeof VSCodeStepParamsSchema>;

const VSCODE_APP_NAME = 'Visual Studio Code';

export const vscodeTool: ToolPlugin<VSCodeStepParams> = {
  type: 'vscode',

  validate(params: unknown): ValidationResult {
    const result = VSCodeStepParamsSchema.safeParse(params);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: result.error.issues.map((issue) => issue.message) };
  },

  async run(params: VSCodeStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const result = await getPlatformLauncher().openInApp(VSCODE_APP_NAME, expandHome(params.path));
    return {
      success: result.success,
      message: result.message,
      durationMs: Date.now() - startedAt,
    };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for VS Code steps yet.', durationMs: 0 };
  },
};
