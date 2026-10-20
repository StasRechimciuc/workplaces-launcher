import {
  appDisplayName,
  CHROME_APP_NAME,
  CLOCKIFY_APP_NAME,
  SPOTIFY_APP_NAME,
  TOOL_APP_KEYS,
  VSCODE_APP_NAME,
  type AppCandidate,
  type ToolAppKey,
} from '@workspace-launcher/shared';
import { runCommand } from '../lib/shell-exec';

// Same bound as app-icon.ts's own plutil/sips calls — mdfind reads
// from Spotlight's already-built index, normally well under a second;
// this just guards against a stuck `mdimport` or an unindexed volume
// hanging the query indefinitely.
const COMMAND_TIMEOUT_MS = 5000;

const PRODUCT_FAMILY_NAME: Record<ToolAppKey, string> = {
  vscode: VSCODE_APP_NAME,
  chrome: CHROME_APP_NAME,
  spotify: SPOTIFY_APP_NAME,
  clockify: CLOCKIFY_APP_NAME,
};

/**
 * Finds every real, installed `.app` bundle whose Spotlight-indexed
 * display name contains the given product-family name — system-wide,
 * not limited to /Applications/~/Applications/System/Applications.
 *
 * This is deliberately the same source of truth macOS's own
 * `open -a "<name>"` already draws from (Launch Services, which is
 * built from the same app-registration/indexing machinery as
 * Spotlight) — confirmed empirically (not assumed) after a real
 * machine showed the exact gap this fixes: an app downloaded but never
 * dragged into /Applications (e.g. `~/Downloads/Clockify Desktop.app`)
 * already launched fine via the plain-name fallback, while a prior,
 * narrower 3-folder directory scan reported it as "not found." Scanning
 * the same index Launch Services itself uses means detection and
 * launch can no longer disagree about whether an app exists.
 *
 * `kMDItemDisplayName` is filename-derived (confirmed empirically to
 * equal `appDisplayName(path)`, e.g. "Visual Studio Code" — not the
 * bundle's own CFBundleDisplayName plist value, which for a real VS
 * Code install is literally "Code"), so matching against the product
 * family's full name (not a short/ambiguous fragment) is safe here the
 * same way it was for the old directory-name match.
 *
 * Never throws and never recurses into a bundle's own Contents (mdfind
 * only ever returns bundle paths, not their contents) — a failed or
 * empty query is zero candidates, not an error, same fail-soft contract
 * every other call in this feature follows. Never returns a single
 * silently-picked winner — always the full candidate list (e.g. a
 * stray installer stub like "Install Spotify.app" sitting alongside the
 * real "Spotify.app" both surface), so the caller (the renderer's
 * disambiguation UI, or the orchestrator's own ephemeral first-
 * candidate fallback) decides what "found exactly one" vs. "found
 * several" means — this was already true of the old implementation and
 * isn't a new risk mdfind introduces.
 */
async function findAppsByDisplayName(productFamilyName: string): Promise<AppCandidate[]> {
  // productFamilyName is always one of this file's own fixed constants
  // (never user input), so this escaping is defensive insurance, not a
  // security boundary — the query itself is passed as a single argv
  // element to mdfind (shell:false), never shell-interpolated.
  const escaped = productFamilyName.replace(/(["\\])/g, '\\$1');
  const query = `kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '*${escaped}*'c`;

  const result = await runCommand('mdfind', [query], { timeoutMs: COMMAND_TIMEOUT_MS });
  if (!result.success) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((path) => ({ path, displayName: appDisplayName(path) }));
}

/**
 * Full scan: queries Spotlight once per known tool, in parallel. See
 * findAppsByDisplayName's own doc comment for why this searches the
 * system-wide index rather than walking fixed folders.
 */
export async function scanInstalledApps(): Promise<Record<ToolAppKey, AppCandidate[]>> {
  const entries = await Promise.all(
    TOOL_APP_KEYS.map(
      async (key) => [key, await findAppsByDisplayName(PRODUCT_FAMILY_NAME[key])] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<ToolAppKey, AppCandidate[]>;
}
