import { join } from 'node:path';
import { runCommand } from '../../lib/shell-exec';

// Same bound as app-icon.ts's own plutil calls — a local file read,
// normally well under a second.
const PLUTIL_TIMEOUT_MS = 5000;

// Reverse-DNS: what wl-helper itself accepts (Protocol.swift), so a
// value read here is never rejected there.
const BUNDLE_ID = /^[A-Za-z0-9._-]{1,255}$/;

/**
 * The CFBundleIdentifier of a `.app` bundle — the identity an app
 * resource is tracked by (resources/kinds/app-kind.ts). `appPath` is
 * passed to plutil as a plain argv entry (shell:false), never
 * interpolated. null when the bundle or its Info.plist can't be read,
 * or the value isn't a well-formed bundle id; the reason is logged.
 */
export async function readBundleId(appPath: string): Promise<string | null> {
  const plistPath = join(appPath, 'Contents', 'Info.plist');
  const result = await runCommand('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plistPath], {
    timeoutMs: PLUTIL_TIMEOUT_MS,
  });
  if (!result.success) {
    console.error(
      `Couldn't read the bundle id of ${appPath}: ${result.stderr.trim() || result.message}`,
    );
    return null;
  }
  const bundleId = result.stdout.trim();
  if (!BUNDLE_ID.test(bundleId)) {
    console.error(
      `${appPath} has a malformed bundle id: ${JSON.stringify(bundleId.slice(0, 100))}`,
    );
    return null;
  }
  return bundleId;
}
