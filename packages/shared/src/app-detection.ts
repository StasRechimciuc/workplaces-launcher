/**
 * The product-family display name each built-in tool step launches —
 * single source of truth, used both by each tool's own run() (as the
 * name-based `open -a` fallback) and by platform/app-detection.ts's
 * real-install-path scan (matched as a substring against a candidate
 * .app bundle's own directory name). Lives here, not in tools/*.ts or
 * orchestrator/tool-identity.ts, specifically so neither of those two
 * layers has to import from the other — tools/ already imports from
 * platform/ (getPlatformLauncher), so platform/app-detection.ts
 * importing these constants FROM tools/*.ts would invert that
 * direction and risk a real import cycle.
 */
export const VSCODE_APP_NAME = 'Visual Studio Code';
export const CHROME_APP_NAME = 'Google Chrome';
export const SPOTIFY_APP_NAME = 'Spotify';
export const CLOCKIFY_APP_NAME = 'Clockify Desktop';

/** The 4 built-in tool types this app can auto-detect a real install
 * path for — distinct from every other step type (docker/terminal/
 * slack: unimplemented; app: user-picked, nothing to detect). */
export type ToolAppKey = 'vscode' | 'chrome' | 'spotify' | 'clockify';

export const TOOL_APP_KEYS: readonly ToolAppKey[] = ['vscode', 'chrome', 'spotify', 'clockify'];

export function isToolAppKey(value: unknown): value is ToolAppKey {
  return typeof value === 'string' && (TOOL_APP_KEYS as readonly string[]).includes(value);
}

/** One real, installed .app bundle found on this machine that matches
 * a tool's product family — never a single silently-picked winner,
 * always returned as part of a list the UI can show. */
export interface AppCandidate {
  path: string;
  displayName: string;
}

export type DetectAppResult =
  | { success: true; candidates: AppCandidate[] }
  | { success: false; error: string; code: string };
