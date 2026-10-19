import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../lib/shell-exec';

// Local, generous but bounded — plutil/sips are normally sub-second
// local operations, but this guards against the kind of hang a daemon-
// backed alternative (qlmanage, tried and discarded — see this file's
// own doc comment) can exhibit, so a slow/stuck icon lookup can never
// block the UI indefinitely.
const COMMAND_TIMEOUT_MS = 5000;

/**
 * Resolves a `.app` bundle's own real icon as a data URL, for the
 * generic "App" step type's badge — the only type whose badge can't
 * use a static bundled logo (public/tool-logos/), since it can point
 * at any installed app.
 *
 * Electron's own `app.getFileIcon()` was tried first and discarded: it
 * returns the exact same generic placeholder for every `.app` bundle
 * (confirmed empirically — byte-identical output for several real,
 * visually distinct apps), since a `.app` bundle is technically a
 * directory and getFileIcon doesn't resolve a directory's own custom
 * icon resource. QuickLook's `qlmanage -t` was tried next — it DOES
 * resolve real icons correctly, but is backed by a system daemon and
 * proved unreliably slow/hanging in testing, unsafe for something a
 * user triggers by picking an app.
 *
 * The mechanism that actually works, and the one Finder itself
 * ultimately relies on: the bundle's own Info.plist names its icon
 * resource (`CFBundleIconFile`, under Contents/Resources/, historically
 * without its `.icns` extension spelled out), converted to PNG via
 * `sips` — both standard macOS CLI tools, no new dependency, no native
 * module. Both calls go through shell-exec.ts's runCommand (argv array,
 * shell:false) — the app's own path and the derived file paths built
 * from it are never concatenated into a shell string.
 *
 * Returns null (never throws) at any failure point — a missing
 * Info.plist, no CFBundleIconFile key (e.g. an app that only ships an
 * asset-catalog icon with no legacy .icns fallback — not handled here,
 * a known limitation), a missing icon file, or sips failing to convert
 * it — so the renderer can fall back to the generic tinted badge
 * cleanly, same "fail loudly in logs, gracefully in UI" rule this
 * codebase applies elsewhere.
 */
export async function getAppIconDataUrl(appPath: string): Promise<string | null> {
  const plistPath = join(appPath, 'Contents', 'Info.plist');
  const plistResult = await runCommand(
    'plutil',
    ['-extract', 'CFBundleIconFile', 'raw', plistPath],
    { timeoutMs: COMMAND_TIMEOUT_MS },
  );
  if (!plistResult.success) {
    return null;
  }

  const iconFile = plistResult.stdout.trim();
  if (!iconFile) {
    return null;
  }
  const iconFileName = iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`;
  // CFBundleIconFile is read from the bundle's own Info.plist, not
  // directly user-typed — but `appPath` itself is an arbitrary,
  // user-chosen path (the whole point of the generic 'app' step type),
  // so a bundle placed there by something untrusted could still ship a
  // crafted Info.plist. A value like "../../../../etc/passwd" would
  // otherwise make `sips` read and return a file far outside the
  // bundle's own Resources folder as if it were an icon. Reject any
  // path separator or traversal segment before it's ever joined.
  if (iconFileName.includes('/') || iconFileName.includes('..')) {
    return null;
  }
  const icnsPath = join(appPath, 'Contents', 'Resources', iconFileName);

  const tempPngPath = join(tmpdir(), `workspace-launcher-app-icon-${randomUUID()}.png`);
  try {
    const sipsResult = await runCommand(
      'sips',
      ['-s', 'format', 'png', icnsPath, '--out', tempPngPath, '--resampleHeightWidthMax', '64'],
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    if (!sipsResult.success) {
      return null;
    }

    const pngBuffer = await readFile(tempPngPath);
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  } catch (err) {
    console.error(
      `Failed to read app icon for "${appPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    // sips may never have written the file at all (e.g. it failed
    // before reaching --out) — unlink's own ENOENT in that case is
    // expected, not a real cleanup failure worth logging.
    await unlink(tempPngPath).catch(() => {});
  }
}
