import type { ResourceSpec } from '@workspace-launcher/shared';

/**
 * The browser-window resource spec (see browser-window-kind.ts), apart
 * from the kind so chrome-tool.ts can build it without the kind's
 * dependencies.
 */

export const BROWSER_WINDOW_KIND = 'browser-window';

export interface BrowserWindowTarget {
  /** Which browser app — by bundle id (Chrome, Brave and Edge differ). */
  bundleId: string;
  /** The name its scripting interface answers to, e.g. "Google Chrome". */
  appName: string;
  /** Profile directory, e.g. "Default". */
  profile: string;
  /** What the user calls the profile, for messages. */
  profileLabel: string;
  /** The step it belongs to — each step owns its own window. */
  stepId: string;
  /**
   * URLs a step saved before the window remembered its own tabs — the
   * first Restore's tabs, once; after that, the tabs last open in it.
   */
  seedUrls: readonly string[];
  /** The window is named after it (Chrome's "Name window"). */
  workspaceName: string;
}

/**
 * One browser step's own window: the browser, the profile and the step.
 * Its tabs aren't part of it — the window remembers whatever was last
 * open in it (browser-sessions.ts). Changing the profile makes it a
 * different window; renaming the workspace keeps it.
 */
export function browserWindowResource(target: BrowserWindowTarget): ResourceSpec {
  return {
    kind: BROWSER_WINDOW_KIND,
    identity: {
      bundleId: target.bundleId,
      profile: target.profile,
      stepId: target.stepId,
    },
    label: `${target.appName} window (${target.profileLabel})`,
    appName: target.appName,
    options: {
      appName: target.appName,
      windowName: target.workspaceName,
      seedUrls: JSON.stringify(target.seedUrls),
    },
  };
}
