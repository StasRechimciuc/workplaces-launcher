import type { PlatformLauncher, PlatformResult } from '../types';
import { runCommand } from '../../lib/shell-exec';

/**
 * macOS implementation of PlatformLauncher, via `open -a`
 * (docs/architecture.md #1). All three methods shell out through
 * lib/shell-exec.ts's runCommand — argv arrays only, shell:false — so
 * an app name or path coming from workspace config data can never be
 * interpreted as shell syntax, no matter what it contains.
 */
export const macosLauncher: PlatformLauncher = {
  async launchApp(appName): Promise<PlatformResult> {
    const result = await runCommand('open', ['-a', appName]);
    if (result.success) {
      return { success: true, message: `Launched ${appName}.` };
    }
    return { success: false, message: `Failed to launch ${appName}: ${result.message}` };
  },

  async openInApp(appName, targetPath): Promise<PlatformResult> {
    const result = await runCommand('open', ['-a', appName, targetPath]);
    if (result.success) {
      return { success: true, message: `Opened ${targetPath} in ${appName}.` };
    }
    return {
      success: false,
      message: `Failed to open ${targetPath} in ${appName}: ${result.message}`,
    };
  },

  async openUrlInBrowserProfile(browser, profile, url): Promise<PlatformResult> {
    // `--args` hands everything after it to the launched app itself,
    // not to `open`. `--profile-directory` is Chrome's (and other
    // Chromium-based browsers') flag for selecting a profile by its
    // on-disk directory name (e.g. "Default", "Profile 1") — NOT the
    // human-readable name shown in the browser's UI (e.g. "Work").
    // Resolving a friendly name to its directory (reading the
    // browser's `Local State` file) isn't implemented yet — callers
    // must pass the actual directory name for now.
    const result = await runCommand('open', [
      '-a',
      browser,
      '--args',
      `--profile-directory=${profile}`,
      url,
    ]);
    if (result.success) {
      return { success: true, message: `Opened ${url} in ${browser} (profile: ${profile}).` };
    }
    return {
      success: false,
      message: `Failed to open ${url} in ${browser}: ${result.message}`,
    };
  },
};
