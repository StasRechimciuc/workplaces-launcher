import {
  appDisplayName,
  CHROME_APP_NAME,
  CLOCKIFY_APP_NAME,
  SPOTIFY_APP_NAME,
  VSCODE_APP_NAME,
} from '@workspace-launcher/shared';

/**
 * Maps a step to the macOS application name it launches, for workspace
 * activity tracking (Restore/Switch/Close — see
 * WCs/WC__workspace-activity.md). This is deliberately NOT a
 * ToolPlugin method: only five step
 * types need this, and reusing each tool's product-family name
 * constant (packages/shared/src/app-detection.ts — the same single
 * source of truth platform/app-detection.ts's real-install-path scan
 * also matches against) here is simpler than widening the shared
 * interface (and `teardown()`, still a Tier 2 no-op) for a macOS-only,
 * v1 feature.
 *
 * Raw-params contract like ToolPlugin's `detail`/`expand` — never
 * throws, degrades gracefully for whatever's actually on disk.
 * `undefined` means this step has no app name to track (an
 * unimplemented/unknown type, or an 'app' step with no path chosen
 * yet) — it's simply never counted toward the running set.
 */
export function getMacAppName(type: string, params: Record<string, unknown>): string | undefined {
  switch (type) {
    case 'vscode':
      return VSCODE_APP_NAME;
    case 'chrome':
      return CHROME_APP_NAME;
    case 'spotify':
      return SPOTIFY_APP_NAME;
    case 'clockify':
      return CLOCKIFY_APP_NAME;
    case 'app': {
      const path = params['path'];
      return typeof path === 'string' && path.length > 0 ? appDisplayName(path) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * True for a type whose app can't be safely auto-closed. Chrome is a
 * singleton process per profile — asking it to open a different
 * profile routes through the already-running process rather than
 * spawning a new one, so there's no reliable way to close "just this
 * profile" without risking closing more than intended (see
 * WCs/WC__workspace-activity.md's research). Still liveness-checked
 * (for Active-display correctness) — just never quit.
 */
export function isExcludedFromAutoClose(type: string): boolean {
  return type === 'chrome';
}
