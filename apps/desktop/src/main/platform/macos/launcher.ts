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
    //
    // `url` is optional: a profile-only launch (no specific tab to
    // open) still needs --profile-directory so the right profile's
    // window opens, but there's nothing else to hand off after it.
    //
    // `-n` is required, not optional flourish: macOS's `open -a` only
    // delivers `--args` argv to the app at the moment it actually
    // spawns a new process. If the browser is already running (the
    // common case — most people leave Chrome open), `open -a` just
    // activates the existing process and both --profile-directory and
    // the URL are silently dropped, never reaching Chrome at all —
    // confirmed live (`open -a` alone did nothing with Chrome already
    // running; adding `-n` opened the URL correctly). `-n` forces a
    // genuinely new process every time, which is how Chrome is
    // designed to be driven per-profile from the CLI regardless of
    // whether it's already open; on a cold start (nothing running yet)
    // it behaves identically to a plain launch.
    const args = ['-n', '-a', browser, '--args', `--profile-directory=${profile}`];
    if (url !== undefined) {
      args.push(url);
    }
    const result = await runCommand('open', args);

    if (url === undefined) {
      if (result.success) {
        return { success: true, message: `Opened ${browser} (profile: ${profile}).` };
      }
      return {
        success: false,
        message: `Failed to open ${browser} (profile: ${profile}): ${result.message}`,
      };
    }

    if (result.success) {
      return { success: true, message: `Opened ${url} in ${browser} (profile: ${profile}).` };
    }
    return {
      success: false,
      message: `Failed to open ${url} in ${browser}: ${result.message}`,
    };
  },
};
