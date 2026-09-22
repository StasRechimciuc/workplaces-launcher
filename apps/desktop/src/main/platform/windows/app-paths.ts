import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

// This module always builds Windows-style paths, regardless of the host
// OS running the code (e.g. during development on macOS) — node:path's
// default `join` follows the *host* platform's separator, which would
// silently produce mixed-separator paths on non-Windows. `path.win32`
// is always backslash-joined, matching what these paths need to be once
// this code actually runs on win32.
const { join } = win32;

/**
 * Maps each known Tier-1 GUI app (docs/build-shell.md) to its real .exe
 * install-path candidates on Windows, checked in order. There is no
 * Windows API for "launch installed GUI app by friendly name" that
 * doesn't itself require cmd.exe/PowerShell (see ./launcher.ts) — and
 * every candidate here must be the app's real binary, never a .cmd/.bat
 * shim (same file, same reason). existsSync is a reasonable, not
 * exhaustive, check — same honesty gap macOS's `open -a <name>` has,
 * which also just trusts Launch Services' own index.
 *
 * Read once, not per-call, so a lookup here can't observe a mid-call
 * change to process.env.
 */
const env = process.env;

const KNOWN_APP_PATHS: Readonly<Record<string, readonly string[]>> = {
  'Visual Studio Code': [
    // Per-user install ("Add to PATH" during setup) — most common.
    join(env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    join(env['ProgramFiles'] ?? '', 'Microsoft VS Code', 'Code.exe'),
    join(env['ProgramFiles(x86)'] ?? '', 'Microsoft VS Code', 'Code.exe'),
  ],
  'Google Chrome': [
    join(env['ProgramFiles'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env['ProgramFiles(x86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Per-user install (no admin rights at install time).
    join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  // Non-Store installer only — per-user, under Roaming (APPDATA, not
  // LOCALAPPDATA). The Microsoft Store variant is a UWP package with no
  // fixed .exe path (needs AUMID + `explorer.exe shell:AppsFolder\...`,
  // a different launch mechanism entirely) — deliberately not covered
  // here; don't "fix" this by adding a Store-style path.
  Spotify: [join(env.APPDATA ?? '', 'Spotify', 'Spotify.exe')],
  // Squirrel-installed (same per-user pattern as Discord/Atom).
  Slack: [join(env.LOCALAPPDATA ?? '', 'slack', 'slack.exe')],
};

/**
 * Resolves a known app name to its installed .exe path. Throws — never
 * returns a sentinel — so callers can't mistake "not found" for
 * success; per claude.md's no-silent-failure rule, an unknown app name
 * and a known-but-uninstalled app get distinct, actionable messages.
 */
export function resolveAppPath(appName: string): string {
  const candidates = KNOWN_APP_PATHS[appName];
  if (!candidates) {
    throw new Error(
      `"${appName}" is not a known Windows app (known: ${Object.keys(KNOWN_APP_PATHS).join(', ')}).`,
    );
  }

  const found = candidates.find((path) => path !== '' && existsSync(path));
  if (!found) {
    throw new Error(
      `Could not find ${appName} installed on this machine. Checked: ${candidates.join(', ')}`,
    );
  }

  return found;
}
