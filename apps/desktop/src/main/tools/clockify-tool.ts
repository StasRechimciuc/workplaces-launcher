import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { CLOCKIFY_APP_NAME, ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { resolveAppLaunchTarget } from './resolve-app-path';

// Clockify has no confirmed URI scheme and no target to launch into —
// this step just opens the desktop app, same as Spotify's own
// "no playlist configured" path. Auto-starting a timer via Clockify's
// REST API (API key, project picker) was explicitly researched and
// descoped — not part of this tool. `appPath` is the one real field:
// the detected install path this step launches (see vscode-tool.ts's
// identical field for the full precedent/reasoning).
const ClockifyStepParamsSchema = z.object({
  appPath: z.string().optional(),
});

export type ClockifyStepParams = z.infer<typeof ClockifyStepParamsSchema>;

export const clockifyTool: ToolPlugin<ClockifyStepParams> = {
  type: 'clockify',

  validate(params: unknown): ValidationResult<ClockifyStepParams> {
    return zodValidate(ClockifyStepParamsSchema, params);
  },

  async run(params: ClockifyStepParams): Promise<StepResult> {
    const startedAt = Date.now();

    const resolved = await resolveAppLaunchTarget('clockify', CLOCKIFY_APP_NAME, params.appPath);
    if (!resolved.ok) {
      return {
        success: false,
        message: `${resolved.message} Clockify was not opened.`,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.APP_PATH_NOT_FOUND.code,
      };
    }

    const result = await getPlatformLauncher().launchApp(resolved.target);
    return {
      success: result.success,
      message: result.message,
      durationMs: Date.now() - startedAt,
      ...(result.success ? {} : { code: ERROR_CODES.APP_LAUNCH_FAILED.code }),
    };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for Clockify steps yet.', durationMs: 0 };
  },

  // Nothing to read from params — there's exactly one thing this step
  // can do, so detail()/expand() are constant regardless of input.
  detail(): string {
    return 'Opens Clockify.';
  },

  expand(): StepDisplayRow[] | undefined {
    return undefined;
  },
};
