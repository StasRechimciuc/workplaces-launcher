import { z } from 'zod';
import type { StepResult, ToolPlugin, ValidationResult } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';

const ChromeStepParamsSchema = z.object({
  profile: z.string().min(1, 'profile must be a non-empty string'),
  // Defaults to [] rather than being required: a profile-only launch
  // (no urls at all) is a real, supported case (see
  // platform/*/launcher.ts's optional `url` param), and the UI's urls
  // textarea is genuinely optional — never touching it must not make
  // the whole step fail to save with a confusing "Required" error.
  urls: z.array(z.string().min(1, 'each url must be a non-empty string')).default([]),
});

export type ChromeStepParams = z.infer<typeof ChromeStepParamsSchema>;

const CHROME_APP_NAME = 'Google Chrome';

export const chromeTool: ToolPlugin<ChromeStepParams> = {
  type: 'chrome',

  validate(params: unknown): ValidationResult {
    const result = ChromeStepParamsSchema.safeParse(params);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: result.error.issues.map((issue) => issue.message) };
  },

  async run(params: ChromeStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const launcher = getPlatformLauncher();

    // validate()'s zod default([]) for `urls` is only used to decide
    // pass/fail — it never writes the defaulted value back into the
    // params that get saved to disk or the raw params the orchestrator
    // later passes to run(). A step saved before ever touching the
    // urls textarea is persisted as `{profile: '...'}` with no `urls`
    // key at all, which still passes validate() (defaulting makes it
    // valid) but would crash here on `.length` without this guard.
    const urls = Array.isArray(params.urls) ? params.urls : [];

    if (urls.length === 0) {
      const result = await launcher.openUrlInBrowserProfile(CHROME_APP_NAME, params.profile);
      return {
        success: result.success,
        message: result.message,
        durationMs: Date.now() - startedAt,
      };
    }

    // Sequential, not Promise.all — the first call is what actually
    // launches/activates Chrome on this profile if it isn't already
    // running. Firing every URL at once gives the OS's app-activation
    // machinery no guaranteed order to finish registering the (about-
    // to-be) singleton browser process before the next open request
    // lands, risking N separate windows on a cold start instead of one
    // Chrome window with N tabs.
    //
    // UNVERIFIED EDGE CASE: `await`ing each `open -n` call only waits
    // for the short-lived `open` broker to exit, not for Chrome itself
    // to finish starting and registering its singleton lock — on a
    // genuinely cold start (Chrome not already running), the second
    // URL's `open -n` could still race that window and spawn a second
    // window instead of a second tab. Testing this for real would mean
    // quitting the founder's actual running Chrome to force a cold
    // start, which isn't something to do without asking first — left
    // as-is (already-running Chrome, the common case, has no race at
    // all: the singleton is already registered). Revisit if a cold-
    // start multi-tab restore is ever reported as opening separate
    // windows.
    const failed: string[] = [];
    for (const url of urls) {
      const result = await launcher.openUrlInBrowserProfile(CHROME_APP_NAME, params.profile, url);
      if (!result.success) {
        failed.push(`${url} (${result.message})`);
      }
    }

    if (failed.length === 0) {
      return {
        success: true,
        message: `Opened ${urls.length} tab${urls.length === 1 ? '' : 's'} in ${CHROME_APP_NAME} (profile: ${params.profile}).`,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      success: false,
      message: `Opened ${urls.length - failed.length} of ${urls.length} tab(s) in ${CHROME_APP_NAME} (profile: ${params.profile}); failed: ${failed.join(', ')}.`,
      durationMs: Date.now() - startedAt,
    };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for Chrome steps yet.', durationMs: 0 };
  },
};
