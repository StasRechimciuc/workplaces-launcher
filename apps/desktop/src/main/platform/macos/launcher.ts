import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from 'electron';
import type { PlatformLauncher, PlatformResult } from '../types';
import { runCommand } from '../../lib/shell-exec';
import { expandHome } from '../../lib/paths';

/**
 * Safe to embed in a single-quoted shell string — the only quoting
 * context any dynamic text in openTerminal's generated script is ever
 * placed into (never re-embedded into a second, differently-quoted
 * context — that mismatch was a real bug here once, see openTerminal's
 * own comment on it).
 */
function singleQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS implementation of PlatformLauncher, via `open -a`
 * (docs/architecture.md #1). All methods shell out through
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

  async openTerminal(cwd, commands): Promise<PlatformResult> {
    const expandedCwd = expandHome(cwd);

    try {
      const dirStat = await stat(expandedCwd);
      if (!dirStat.isDirectory()) {
        return { success: false, message: `"${cwd}" is not a directory.` };
      }
    } catch {
      return { success: false, message: `"${cwd}" doesn't exist.` };
    }

    // Deliberately NOT AppleScript (`do script`) — embedding dynamic
    // content into an AppleScript string is a real, two-layer escaping
    // problem (AppleScript-string escaping, then shell-interpretation
    // of whatever ends up typed into the terminal), confirmed during
    // this feature's own planning to be a genuine, non-theoretical risk
    // class. Instead: a plain Node fs.writeFile writes an executable
    // `.command` script — inert bytes, no interpretation at all — and
    // `open -a Terminal` (the same `open`-based, argv-only mechanism
    // every other method here already uses) hands it to Terminal the
    // same way a double-click would. This also means no macOS
    // Automation/TCC permission prompt is ever triggered (`open` is a
    // Launch Services request, not an Apple Event).
    //
    // `-a Terminal` is explicit, not left to Launch Services' default
    // `.command` handler — matching every other call in this file's own
    // explicit `-a <app>` convention, and avoiding a real silent-wrong-
    // outcome risk: a user who has ever rebound `.command`/`.sh` files
    // to open in a text editor instead of running them would otherwise
    // get an `open` call that exits 0 ("success") while doing something
    // entirely different from what this step promises.
    const safeCwd = singleQuote(expandedCwd);
    const lines = [
      '#!/bin/zsh -l',
      // Self-deletes immediately — the interpreter already has the
      // file open by the time this runs, so unlinking it doesn't
      // disturb execution. Required, not optional: without it, every
      // restore leaves a new script behind in the temp dir forever.
      'rm -f -- "$0"',
      // Terminal.app's own behavior when it opens a .command file (via
      // `open -a Terminal`, same as a double-click) — not anything this
      // script controls — is to visibly "type" the script's full path
      // plus a trailing `; exit` into a fresh shell before running it.
      // Wiping that noisy preamble here is purely cosmetic (the window
      // stays open and interactive regardless, since `exec "$SHELL" -l`
      // below replaces the process before that trailing `exit` could
      // ever act on it) — it just means the user sees a clean prompt
      // instead of their own temp file's path first.
      'clear',
      `cd ${safeCwd} || { echo "cd into the configured directory failed."; exec "$SHELL" -l; }`,
      // Each command is echoed as its own, separately-escaped
      // `echo '$ <command>'` line before it actually runs — a plain
      // shell script never echoes its own commands by default, so
      // without this there'd be no visible indication of what's
      // running before its output starts. The echoed text is embedded
      // into its OWN single-quoted string via the same singleQuote()
      // helper as cwd above — never the same escaped string reused for
      // two different quoting contexts, which is exactly the mixed-
      // context bug a prior version of this file had elsewhere. The
      // command's own execution line (the second of the pair) stays
      // completely verbatim and unescaped — it's meant to run exactly
      // as the user typed it, in their own real shell.
      ...commands.flatMap((command) => [`echo ${singleQuote(`$ ${command}`)}`, command]),
      'exec "$SHELL" -l',
    ];
    const scriptPath = join(tmpdir(), `workspace-launcher-terminal-${randomUUID()}.command`);

    try {
      await writeFile(scriptPath, `${lines.join('\n')}\n`, { mode: 0o755 });
    } catch (err) {
      return {
        success: false,
        message: `Couldn't create the terminal script: ${(err as Error).message}`,
      };
    }

    const result = await runCommand('open', ['-a', 'Terminal', scriptPath]);
    if (result.success) {
      return { success: true, message: `Opened a terminal at ${cwd}.` };
    }
    return { success: false, message: `Failed to open a terminal at ${cwd}: ${result.message}` };
  },

  async openFileDefault(path): Promise<PlatformResult> {
    // shell.openPath's documented contract: it does NOT throw for a
    // normal "couldn't open" failure (no handler app, permissions,
    // etc.) — it resolves with '' on success, or a non-empty
    // human-readable error string on failure. Checking only for a
    // thrown exception here would silently treat every such failure as
    // success — confirmed as a real risk during this feature's own
    // planning, not a hypothetical.
    try {
      const errorMessage = await shell.openPath(path);
      if (errorMessage === '') {
        return { success: true, message: `Opened ${path}.` };
      }
      return { success: false, message: `Failed to open ${path}: ${errorMessage}` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to open ${path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async openUrlDefault(url): Promise<PlatformResult> {
    try {
      await shell.openExternal(url);
      return { success: true, message: `Opened ${url}.` };
    } catch (err) {
      return {
        success: false,
        message: `Failed to open ${url}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
