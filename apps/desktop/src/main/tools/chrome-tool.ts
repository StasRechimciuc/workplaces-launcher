import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { zodValidate } from '@workspace-launcher/shared';
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

  validate(params: unknown): ValidationResult<ChromeStepParams> {
    return zodValidate(ChromeStepParamsSchema, params);
  },

  async run(params: ChromeStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const launcher = getPlatformLauncher();

    // orchestrator.ts now passes validate()'s already-defaulted `data`
    // here, so `params.urls` is guaranteed an array on that path — this
    // guard is redundant-in-practice for it. Kept anyway: `run()` is a
    // public ToolPlugin method, and nothing enforces every caller
    // (tests, any future path) routes through a zod parse first.
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

  // Raw-params contract (ToolPlugin.detail/expand's own doc comment) —
  // relocated verbatim from config/workspace-display.ts's old
  // detailForStep/expandForStep 'chrome' branches, not new logic. Must
  // handle a missing `profile` gracefully (not guaranteed present —
  // this operates on raw, possibly-invalid saved params, unlike run()).
  detail(params) {
    const profile = typeof params['profile'] === 'string' ? params['profile'] : undefined;
    const urls = Array.isArray(params['urls'])
      ? params['urls'].filter((u): u is string => typeof u === 'string')
      : [];
    if (!profile) {
      return 'Opens Chrome — no profile configured yet.';
    }
    if (urls.length === 0) {
      return `Opens Chrome (profile: ${profile}).`;
    }
    return `Opens ${urls.length} tab${urls.length === 1 ? '' : 's'} in Chrome (profile: ${profile}).`;
  },

  expand(params): StepDisplayRow[] | undefined {
    const profile = typeof params['profile'] === 'string' ? params['profile'] : undefined;
    if (!profile) {
      return undefined;
    }
    const urls = Array.isArray(params['urls'])
      ? params['urls'].filter((u): u is string => typeof u === 'string')
      : [];
    return [
      { i: 'globe', label: 'Profile', mono: profile },
      ...urls.map((url) => ({ i: 'check', label: 'Tab', mono: url })),
    ];
  },
};
