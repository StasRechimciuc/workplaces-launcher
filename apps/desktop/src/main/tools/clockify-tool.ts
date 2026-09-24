import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';

// Clockify has no confirmed URI scheme and no target to launch into —
// this step just opens the desktop app, same as Spotify's own
// "no playlist configured" path. Zero fields is deliberate, not a
// placeholder for a future param: auto-starting a timer via Clockify's
// REST API (API key, project picker) was explicitly researched and
// descoped — not part of this tool.
const ClockifyStepParamsSchema = z.object({});

export type ClockifyStepParams = z.infer<typeof ClockifyStepParamsSchema>;

// "Clockify Desktop" (bundle id coing.ClockifyDesktop) is the
// officially-sourced macOS app name — matches this launcher's existing
// `open -a "<name>"` pattern (platform/macos/launcher.ts) exactly, same
// as Spotify/VS Code/Chrome. No confirmed Windows exe name/path exists
// yet, so there is deliberately no KNOWN_APP_PATHS entry for this app
// (platform/windows/app-paths.ts) — resolveAppPath() already fails
// loudly and honestly for an unmapped app name; that's the correct
// behavior until a real Windows install is verified, not a gap to
// paper over with a guess.
const CLOCKIFY_APP_NAME = 'Clockify Desktop';

export const clockifyTool: ToolPlugin<ClockifyStepParams> = {
  type: 'clockify',

  validate(params: unknown): ValidationResult<ClockifyStepParams> {
    return zodValidate(ClockifyStepParamsSchema, params);
  },

  async run(): Promise<StepResult> {
    const startedAt = Date.now();
    const result = await getPlatformLauncher().launchApp(CLOCKIFY_APP_NAME);
    return { success: result.success, message: result.message, durationMs: Date.now() - startedAt };
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
