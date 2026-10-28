import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { appDisplayName, ERROR_CODES, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { appResourceFor } from '../resources/kinds/app-kind';

// A full `.app` bundle path, picked via the native file dialog
// (dialog:selectApp) rather than typed — same "no manual typing"
// direction as every other picker in this app. Storing the full path
// (not a derived display name) means `open -a` resolves it exactly,
// including apps outside /Applications or with a name collision —
// macOS's `open -a` accepts either a bare app name or a full bundle
// path interchangeably, so no change to PlatformLauncher was needed:
// launchApp(appName) already just forwards its argument into `open -a
// "<value>"` (platform/macos/launcher.ts), safely, via execFile's argv
// array — never shell-interpreted, so a path or name containing
// anything unusual still can't be command injection.
const AppStepParamsSchema = z.object({
  path: z.string().min(1, 'An app must be selected.'),
});

export type AppStepParams = z.infer<typeof AppStepParamsSchema>;

// macOS only for now (claude.md's platform roadmap + this feature's own
// working-decisions scope cut): Windows has no equivalent of `open -a`
// resolving an arbitrary app by name/path — it needs the same
// registry-based app-path lookup platform/windows/app-paths.ts already
// does for named apps, which doesn't exist yet for an arbitrary
// user-picked one. Not solved here; the orchestrator already handles an
// unsupported platform as a normal, honest per-step failure (via
// getPlatformLauncher()), not a crash, so this isn't gated further.
export const appTool: ToolPlugin<AppStepParams> = {
  type: 'app',

  validate(params: unknown): ValidationResult<AppStepParams> {
    return zodValidate(AppStepParamsSchema, params);
  },

  async run(params: AppStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const result = await getPlatformLauncher().launchApp(params.path);
    return {
      success: result.success,
      message: result.message,
      durationMs: Date.now() - startedAt,
      ...(result.success ? {} : { code: ERROR_CODES.APP_LAUNCH_FAILED.code }),
    };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for App steps yet.', durationMs: 0 };
  },

  async resources(params) {
    return appResourceFor(params.path, appDisplayName(params.path));
  },

  detail(params: Record<string, unknown>): string {
    const path = params['path'];
    if (typeof path !== 'string' || path.length === 0) {
      return 'Opens an app.';
    }
    return `Opens ${appDisplayName(path)}.`;
  },

  expand(params: Record<string, unknown>): StepDisplayRow[] | undefined {
    const path = params['path'];
    if (typeof path !== 'string' || path.length === 0) {
      return undefined;
    }
    return [{ i: 'appWindow', label: 'App', mono: appDisplayName(path) }];
  },
};
