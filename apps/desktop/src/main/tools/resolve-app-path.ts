import { access } from 'node:fs/promises';
import type { ToolAppKey } from '@workspace-launcher/shared';
import { getCandidatesForTool } from '../platform/app-detection-cache';

export type ResolvedAppTarget = { ok: true; target: string } | { ok: false; message: string };

/**
 * Resolves the value to hand to PlatformLauncher's `openInApp`/
 * `launchApp`/`openUrlInBrowserProfile` — all three already accept a
 * bare app name OR a full path interchangeably via `open -a` (no
 * PlatformLauncher interface change needed; app-tool.ts's generic
 * "App" step already proves this by passing a real path today).
 *
 * 1. `appPath` present (an explicit, user-saved choice, written only
 *    through WorkspaceFormModal's Save flow — never by this function
 *    or by an unattended restore) -> verify it still exists. If gone,
 *    fail LOUDLY with a specific message, never fall through to a
 *    bare name-guess.
 * 2. `appPath` absent (an old/un-migrated config) -> consult the
 *    machine-level detection cache EPHEMERALLY (never written back
 *    into this step's own params): use its first candidate if any
 *    exist.
 * 3. Still nothing (the scan found zero candidates for this tool on
 *    this machine) -> fall back to the original hardcoded app NAME —
 *    exactly today's pre-existing `open -a "<name>"` behavior,
 *    unchanged. Deliberate, not a regression: if that name-based
 *    launch itself then fails, the caller gets exactly the same
 *    honest failure it would have gotten before this feature ever
 *    existed (platform/macos/launcher.ts's existing failure
 *    reporting) — never a NEW silent failure, just the old one,
 *    preserved for the one case detection genuinely can't help with.
 */
export async function resolveAppLaunchTarget(
  toolKey: ToolAppKey,
  fallbackAppName: string,
  appPath: string | undefined,
): Promise<ResolvedAppTarget> {
  if (appPath) {
    try {
      await access(appPath);
      return { ok: true, target: appPath };
    } catch {
      return {
        ok: false,
        message: `${fallbackAppName} not found at ${appPath} — it may have moved or been uninstalled.`,
      };
    }
  }

  const candidates = await getCandidatesForTool(toolKey);
  if (candidates.length > 0) {
    return { ok: true, target: candidates[0]!.path };
  }

  return { ok: true, target: fallbackAppName };
}
