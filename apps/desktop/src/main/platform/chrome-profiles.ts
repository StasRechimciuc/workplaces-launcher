import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

/**
 * Resolves Chrome's real, on-disk profiles by reading its own `Local
 * State` config file directly — the same mechanism Chrome's own
 * cross-profile import feature uses internally (see
 * platform/macos/launcher.ts's own comment anticipating exactly this).
 * No OAuth, no network, no new dependency: a plain local file read.
 */
export interface ChromeProfileInfo {
  /** On-disk directory name — what chrome-tool.ts's `profile` param needs. */
  folder: string;
  /** Display name shown in Chrome's own UI. */
  name: string;
}

function getLocalStatePath(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Local State');
    case 'win32': {
      // UNVERIFIED on a real Windows machine — matches Chromium's own
      // documented user-data-dir layout (%LOCALAPPDATA%\Google\Chrome\
      // User Data), same confidence level as platform/windows/
      // app-paths.ts's existing candidate paths, pending VM access.
      //
      // path.win32.join, not the default (host-platform) join — same
      // reasoning as app-paths.ts's own identical choice: this must
      // always build backslash-joined Windows paths, including when
      // developing/testing on macOS, where the default join would
      // silently produce mixed-separator paths instead.
      const localAppData = process.env['LOCALAPPDATA'];
      if (!localAppData) {
        throw new Error("Could not locate Chrome's profile data: %LOCALAPPDATA% is not set.");
      }
      return win32.join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State');
    }
    default:
      throw new Error(`Chrome profile detection isn't supported on this platform (${process.platform}) yet.`);
  }
}

/**
 * Reads every real Chrome profile on this machine, sorted by display
 * name. Deliberately returns only `{folder, name}` — Local State's
 * `profile.info_cache` entries also carry `gaia_name`/`user_name`
 * (email) and `avatar_icon`, none of which this feature needs; reading
 * them into the renderer or a saved workspace config would be an
 * unnecessary privacy overreach for "which profile to open."
 */
export async function listChromeProfiles(): Promise<ChromeProfileInfo[]> {
  let raw: string;
  try {
    raw = await readFile(getLocalStatePath(), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error("Chrome doesn't appear to be installed (or has never been run) on this machine.");
    }
    throw new Error(`Could not read Chrome's profile data: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Chrome's profile data file is malformed — can't read profiles.");
  }

  const infoCache = (parsed as { profile?: { info_cache?: Record<string, { name?: unknown }> } })
    .profile?.info_cache;
  if (!infoCache) {
    return [];
  }

  return Object.entries(infoCache)
    .map(([folder, info]) => ({
      folder,
      name: typeof info.name === 'string' && info.name.length > 0 ? info.name : folder,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Best-effort "which profile is probably open right now," for "Save my
 * current workspace" detection (WCs/WC__save-current-workspace.md) —
 * reads the SAME `Local State` file as listChromeProfiles, just a
 * different field (`profile.last_used`). This is a point-in-time
 * snapshot Chrome writes on profile switch/exit, not a live query —
 * it's wrong if multiple profile windows are open simultaneously, and
 * callers must treat it as a guess to confirm, never a fact to trust
 * silently. Returns undefined on ANY failure (missing file, malformed
 * JSON, missing field) — detection's chrome step then just omits the
 * profile rather than guessing one.
 */
export async function getLastUsedChromeProfileFolder(): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(getLocalStatePath(), 'utf-8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const lastUsed = (parsed as { profile?: { last_used?: unknown } }).profile?.last_used;
  return typeof lastUsed === 'string' && lastUsed.length > 0 ? lastUsed : undefined;
}
