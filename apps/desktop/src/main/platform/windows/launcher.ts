import type { PlatformLauncher, PlatformResult } from '../types';
import { runDetached } from '../../lib/shell-exec';
import { resolveAppPath } from './app-paths';

/**
 * Windows implementation of PlatformLauncher.
 *
 * macOS's `open -a <name>` has no Windows equivalent that avoids a
 * shell: `start` is a cmd.exe builtin — routing through it means
 * cmd.exe re-parses its own metacharacters (`&`, `|`, `%VAR%`, ...) even
 * behind execFile's argv-array safety, because the *target* process
 * becomes cmd.exe itself (the same class of risk as Node's
 * CVE-2024-27980 for .bat/.cmd files). VS Code's `code` CLI on Windows
 * is exactly this kind of .cmd shim — never target it.
 *
 * Instead: resolve the known app name to its real .exe (app-paths.ts —
 * never a .cmd/.bat shim) and spawn that directly, shell:false. Uses
 * runDetached, not runCommand: unlike `open`, which is a short-lived
 * broker that exits as soon as it hands off to Launch Services, the
 * process spawned here (Code.exe/chrome.exe/...) *is* the long-running
 * app for a fresh launch — awaiting its exit (what runCommand does)
 * would hang until the user closes it.
 *
 * (Electron's `shell.openPath`/`openExternal` were considered and
 * rejected: both defer to the OS's default handler for a path/URL, with
 * no way to force a specific app or pass extra argv like
 * `--profile-directory=...`, which every method below needs.)
 *
 * UNVERIFIED RISK, flag before first real Windows test: this file
 * assumes each target app's own already-running-instance behavior
 * (Chrome/VS Code/Spotify all implement some form of singleton
 * IPC — a named pipe or message window that forwards a second launch's
 * argv to the first instance) correctly honors `--profile-directory=`/
 * a folder path/a URL the same way it would on a fresh launch. This is
 * architecturally different from — and should NOT need — the `-n`
 * workaround macos/launcher.ts's `openUrlInBrowserProfile` required
 * (that bug was specific to macOS's `open -a` activate-vs-launch
 * semantics silently dropping `--args` for an already-running app; this
 * file spawns the .exe directly, with no OS broker in between). But
 * that macOS bug was invisible to mocked unit tests and only caught by
 * live manual testing — the same could be true here. Real Windows
 * end-to-end testing is still blocked on VM access
 * (WCs/WC__project-status.md); when it's unblocked, the FIRST thing to
 * check is exactly this: restore a workspace with Chrome/VS Code
 * already open and confirm the right profile/folder/URL actually opens,
 * not just that the app launches at all.
 */
export const windowsLauncher: PlatformLauncher = {
  async launchApp(appName): Promise<PlatformResult> {
    let exePath: string;
    try {
      exePath = resolveAppPath(appName);
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }

    const result = await runDetached(exePath, []);
    if (result.success) {
      return { success: true, message: `Launched ${appName}.` };
    }
    return { success: false, message: `Failed to launch ${appName}: ${result.message}` };
  },

  async openInApp(appName, targetPath): Promise<PlatformResult> {
    let exePath: string;
    try {
      exePath = resolveAppPath(appName);
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }

    const result = await runDetached(exePath, [targetPath]);
    if (result.success) {
      return { success: true, message: `Opened ${targetPath} in ${appName}.` };
    }
    return {
      success: false,
      message: `Failed to open ${targetPath} in ${appName}: ${result.message}`,
    };
  },

  async openUrlInBrowserProfile(browser, profile, url): Promise<PlatformResult> {
    let exePath: string;
    try {
      exePath = resolveAppPath(browser);
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }

    // `--profile-directory=<dir>` is a genuine Chromium flag, not an
    // `open`-specific one, so it works identically once we have the
    // browser's own .exe — no `--args` marker needed here (that only
    // existed on macOS to separate `open`'s own flags from the target
    // app's). `profile` is still the on-disk directory name (e.g.
    // "Default", "Profile 1"), not the UI-visible profile label. `url`
    // is optional — a profile-only launch omits it, same as macOS.
    const args = [`--profile-directory=${profile}`];
    if (url !== undefined) {
      args.push(url);
    }
    const result = await runDetached(exePath, args);

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
