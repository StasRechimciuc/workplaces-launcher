import {
  appDisplayName,
  CHROME_APP_NAME,
  CLOCKIFY_APP_NAME,
  SPOTIFY_APP_NAME,
  TOOL_APP_KEYS,
  VSCODE_APP_NAME,
  type ToolAppKey,
} from '@workspace-launcher/shared';

/**
 * Maps a step type to the running-app name(s) that identify it, for
 * "Save my current workspace" detection (see
 * WCs/WC__save-current-workspace.md). Deliberately NOT a ToolPlugin
 * method, NOT a new required interface — a standalone, additive map,
 * same precedent as tool-identity.ts's getMacAppName: only step types
 * with a fixed, recognizable product name belong here. A future step
 * type (e.g. a hypothetical Figma integration) becomes detectable by
 * adding one entry here plus one name constant in
 * packages/shared/src/app-detection.ts — no other file changes.
 *
 * Terminal is NOT here: a running Terminal.app/iTerm2 maps to zero or
 * more `terminal` steps (one per window), not one step per running-app
 * match the way vscode/chrome/spotify/clockify do — handled separately
 * by workspace-detection.ts + terminal-inspection.ts. The generic 'app'
 * and 'link' step types are also not here: they have no fixed product
 * name to match against at all, by design — any running app with no
 * entry here falls back to a generic 'app' step instead (see
 * workspace-detection.ts).
 */
export interface DetectionSpec {
  /** Product-family name(s) — reuses the exact same constants
   * platform/app-detection.ts's install-path scan already matches
   * against, so detection and install-scanning can never disagree about
   * what "this running app is VS Code" means. */
  appNames: readonly string[];
}

// Keyed off TOOL_APP_KEYS (packages/shared/src/app-detection.ts's own
// canonical "these are the step types with a fixed, recognizable
// product name" list — ['vscode','chrome','spotify','clockify'] today)
// rather than four separately hand-typed object keys, so a future
// addition to THAT list is automatically detectable here too, without
// a second, independent edit to this file's key set. The name-constant
// wiring below still has to be hand-asserted somewhere (the same is
// true of platform/app-detection.ts's own PRODUCT_FAMILY_NAME) — this
// doesn't fully unify that with tool-identity.ts's separate
// getMacAppName switch (which also covers the dynamic 'app'/'link'
// types DETECTION_SPECS deliberately excludes), a known, documented gap
// rather than a silently accepted one.
const NAME_BY_TOOL_APP_KEY: Record<ToolAppKey, string> = {
  vscode: VSCODE_APP_NAME,
  chrome: CHROME_APP_NAME,
  spotify: SPOTIFY_APP_NAME,
  clockify: CLOCKIFY_APP_NAME,
};

const DETECTION_SPECS: Partial<Record<string, DetectionSpec>> = Object.fromEntries(
  TOOL_APP_KEYS.map((key) => [key, { appNames: [NAME_BY_TOOL_APP_KEY[key]] }]),
);

export function getDetectionSpec(type: string): DetectionSpec | undefined {
  return DETECTION_SPECS[type];
}

/**
 * Reverse lookup: given a running app's real `.app` bundle path, which
 * step type (if any) it matches. Uses `appDisplayName` — the SAME
 * filename-derived matching platform/app-detection.ts's own doc comment
 * confirms is what Spotlight's `kMDItemDisplayName` actually reports
 * (e.g. "Visual Studio Code" from the bundle path), not the process's
 * own internal name (lsappinfo reports VS Code's running process as
 * "Code" — a real, confirmed mismatch that matching on bundle path
 * instead of process name avoids entirely). Substring match, same as
 * findAppsByDisplayName — not exact equality, same reasoning (a
 * "beta"/"insiders" variant bundle still matches).
 *
 * Returns undefined for no match — the caller's fallback is a generic
 * `app` step, never a thrown error.
 */
export function findTypeForBundlePath(bundlePath: string): string | undefined {
  const displayName = appDisplayName(bundlePath).toLowerCase();
  for (const [type, spec] of Object.entries(DETECTION_SPECS)) {
    if (spec?.appNames.some((name) => displayName.includes(name.toLowerCase()))) {
      return type;
    }
  }
  return undefined;
}
