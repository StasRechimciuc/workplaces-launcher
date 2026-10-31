import { z } from 'zod';
import type {
  ResourceSpec,
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import {
  appDisplayName,
  CHROME_APP_NAME,
  ERROR_CODES,
  zodValidate,
} from '@workspace-launcher/shared';
import { readBundleId } from '../platform/macos/bundle-id';
import { identityKeyFor } from '../resources/kind-registry';
import { browserWindowResource } from '../resources/kinds/browser-window-spec';
import { browserAdapterFor, getBrowserSessions } from '../resources/runtime';
import { pollUntil } from '../lib/poll-until';
import { getPlatformLauncher } from '../platform';
import { restoreUrls } from '../platform/browser-placeholder';
import { resolveAppLaunchTarget } from './resolve-app-path';

const ChromeStepParamsSchema = z.object({
  profile: z.string().min(1, 'profile must be a non-empty string'),
  profileName: z.string().optional(),
  /**
   * Only from steps saved before the window remembered its own tabs (the
   * form no longer has the field): the first Restore's tabs, once.
   */
  urls: z.array(z.string().min(1, 'each url must be a non-empty string')).default([]),
  appPath: z.string().optional(),
});

export type ChromeStepParams = z.infer<typeof ChromeStepParamsSchema>;

/**
 * A Chrome step is its own window (WCs/WC__window-tracking.md, Phase
 * 4): opened as a new window of the step's profile — never tabs added
 * to a window the user already has — reused while it's open, and
 * reopened with the tabs it held last time (browser-sessions.ts), the
 * step's own URLs the first time. Only the first tab loads at once;
 * the rest load when clicked.
 */
export const chromeTool: ToolPlugin<ChromeStepParams> = {
  type: 'chrome',

  validate(params: unknown): ValidationResult<ChromeStepParams> {
    return zodValidate(ChromeStepParamsSchema, params);
  },

  async resources(params, context) {
    if (!context) return [];
    const spec = await windowSpec(params, context.stepId, context.workspaceName);
    return spec ? [spec] : [];
  },

  async run(params, context): Promise<StepResult> {
    const startedAt = Date.now();
    const resolved = await resolveAppLaunchTarget('chrome', CHROME_APP_NAME, params.appPath);
    if (!resolved.ok) {
      return {
        success: false,
        message: `${resolved.message} Chrome was not opened.`,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.APP_PATH_NOT_FOUND.code,
      };
    }
    const label = params.profileName || params.profile;

    const spec = context?.stepId ? await windowSpec(params, context.stepId, '') : null;
    const key = spec ? identityKeyFor(spec) : undefined;
    if (key !== undefined && context?.liveResourceKeys?.has(key)) {
      return {
        success: true,
        message: `Already open — reused its Chrome window (profile: ${label}).`,
        durationMs: Date.now() - startedAt,
      };
    }

    const saved = key === undefined ? undefined : getBrowserSessions()?.get(key);
    // The tabs last open in its window; a step saved before windows
    // remembered their tabs starts from its old URLs, once.
    const tabs = saved?.tabs ?? params.urls.map((url) => ({ title: '', url }));
    const launcher = getPlatformLauncher();
    if (!launcher.openBrowserWindow) {
      return {
        success: false,
        message: "Chrome steps aren't supported on this platform yet.",
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.CHROME_TABS_FAILED.code,
      };
    }
    const appName = resolved.target.endsWith('.app')
      ? appDisplayName(resolved.target)
      : CHROME_APP_NAME;
    await openProfileFirst(appName, resolved.target, params.profile);
    const result = await launcher.openBrowserWindow(
      resolved.target,
      params.profile,
      restoreUrls(tabs),
    );
    if (!result.success) {
      return {
        success: false,
        message: result.message,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.CHROME_TABS_FAILED.code,
      };
    }
    const count = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
    return {
      success: true,
      message:
        tabs.length === 0
          ? `Opened a ${CHROME_APP_NAME} window (profile: ${label}).`
          : saved
            ? `Reopened its ${count} from last time in a ${CHROME_APP_NAME} window (profile: ${label}).`
            : `Opened ${count} in a ${CHROME_APP_NAME} window (profile: ${label}).`,
      durationMs: Date.now() - startedAt,
    };
  },

  async teardown(): Promise<StepResult> {
    return { success: true, message: 'No teardown for Chrome steps yet.', durationMs: 0 };
  },

  detail(params) {
    const profile = typeof params['profile'] === 'string' ? params['profile'] : undefined;
    const profileName =
      typeof params['profileName'] === 'string' && params['profileName'].length > 0
        ? params['profileName']
        : undefined;
    if (!profile) {
      return 'Opens Chrome — no profile configured yet.';
    }
    // Prefers the real display name; falls back to the raw folder name
    // for a config saved before profileName existed, or hand-edited.
    const label = profileName ?? profile;
    return `Opens its own Chrome window (profile: ${label}) with the tabs last open in it.`;
  },

  expand(params): StepDisplayRow[] | undefined {
    const profile = typeof params['profile'] === 'string' ? params['profile'] : undefined;
    if (!profile) {
      return undefined;
    }
    const profileName =
      typeof params['profileName'] === 'string' && params['profileName'].length > 0
        ? params['profileName']
        : undefined;
    return [{ i: 'globe', label: 'Profile', mono: profileName ?? profile }];
  },
};

/**
 * The step's window resource — needs the app's bundle id, so an app
 * that isn't a readable .app bundle leaves the step untracked.
 */
async function windowSpec(
  params: ChromeStepParams,
  stepId: string,
  workspaceName: string,
): Promise<ResourceSpec | null> {
  const resolved = await resolveAppLaunchTarget('chrome', CHROME_APP_NAME, params.appPath);
  if (!resolved.ok || !resolved.target.endsWith('.app')) return null;
  const bundleId = await readBundleId(resolved.target);
  if (!bundleId) return null;
  return browserWindowResource({
    bundleId,
    appName: appDisplayName(resolved.target),
    profile: params.profile,
    profileLabel: params.profileName || params.profile,
    stepId,
    seedUrls: params.urls,
    workspaceName,
  });
}

/**
 * A browser profile opened together with the step's tabs first reopens
 * the profile's last session and drops the tabs into one of those
 * windows instead of a new one — so the step's window could never be
 * told apart (seen on this Mac, 2026-10-31; a plain start doesn't help
 * either: it may stop at Chrome's "Who's using Chrome?" picker). Not
 * running: open the profile on its own first and wait until its windows
 * are back (the same count twice in a row); a running profile then
 * always opens the step's tabs in a window of their own (verified for
 * real). Best effort: if it never settles, the open goes ahead and
 * capture decides.
 */
async function openProfileFirst(appName: string, target: string, profile: string): Promise<void> {
  const adapter = browserAdapterFor(appName);
  const state = await adapter.readWindows();
  if (state.ok || state.code !== 'not-running') return;
  const opened = await getPlatformLauncher().openUrlInBrowserProfile(target, profile);
  if (!opened.success) return;
  let previous = -1;
  await pollUntil(
    async () => {
      const read = await adapter.readWindows();
      if (!read.ok) return undefined;
      const settled = read.value.length > 0 && read.value.length === previous;
      previous = read.value.length;
      return settled ? true : undefined;
    },
    { intervalMs: 1_000, timeoutMs: 15_000 },
  );
}
