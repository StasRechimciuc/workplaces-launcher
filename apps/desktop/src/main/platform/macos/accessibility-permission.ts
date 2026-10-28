import { access, constants } from 'node:fs/promises';
import { runCommand } from '../../lib/shell-exec';

/**
 * The trust check behind AccessibilityStatus (see
 * @workspace-launcher/shared) — always a freshly spawned one-shot
 * `wl-helper trust`, never the persistent helper or Electron's own
 * `systemPreferences.isTrustedAccessibilityClient`: a long-running
 * process can keep reporting a stale `true` after the app is removed
 * from the Accessibility list (WCs/WC__window-tracking.md,
 * "Permissions"). The spawned helper's own AX call is also what makes
 * macOS list the app in System Settings on first run.
 */

export type TrustCheckResult = { ok: true; trusted: boolean } | { ok: false; error: string };

// A healthy check returns in well under 100ms — this only bounds a
// helper that hangs, so the onboarding poll can't pile up behind it.
const TRUST_CHECK_TIMEOUT_MS = 5000;

export async function checkAccessibilityTrust(helperPath: string): Promise<TrustCheckResult> {
  try {
    await access(helperPath, constants.X_OK);
  } catch {
    return {
      ok: false,
      error: `The window helper isn't at ${helperPath} (or isn't executable). In a dev build, run "npm run build:helper -w apps/desktop".`,
    };
  }

  const result = await runCommand(helperPath, ['trust'], { timeoutMs: TRUST_CHECK_TIMEOUT_MS });
  if (!result.success) {
    const stderr = result.stderr.trim();
    return {
      ok: false,
      error: `The window helper's permission check failed: ${stderr || result.message}`,
    };
  }
  return parseTrustOutput(result.stdout);
}

/** Exported for tests — the helper's one-line `{"trusted":bool}`. */
export function parseTrustOutput(stdout: string): TrustCheckResult {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { trusted?: unknown }).trusted === 'boolean'
    ) {
      return { ok: true, trusted: (parsed as { trusted: boolean }).trusted };
    }
  } catch {
    // Falls through to the same malformed-output error below.
  }
  return {
    ok: false,
    error: `The window helper's permission check returned unexpected output: ${JSON.stringify(stdout.slice(0, 200))}`,
  };
}
