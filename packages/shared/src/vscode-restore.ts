import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './write-file-atomic';

/**
 * Must match productName in apps/desktop/electron-builder.yml.
 * apps/desktop/src/main/index.ts imports this constant for
 * `app.setName(...)` rather than hardcoding its own copy, so there are
 * only 2 places this can drift, not 3 — but electron-builder.yml's
 * copy is still a plain YAML literal (can't practically import a TS
 * constant), so a future rename must still update it by hand, or the
 * desktop app and the extension would silently compute different
 * directories and the handoff would just stop firing, with no error
 * anywhere.
 */
export const PRODUCT_NAME = 'Workspace Launcher';

/**
 * The current pending-restore file format version. The extension and
 * desktop app ship independently (separate package.json, separate
 * release cadence) — an on-disk skew between producer and consumer is
 * a real possibility, the same class of problem
 * CURRENT_WORKSPACE_CONFIG_VERSION already solves for workspace
 * configs. Mirrors that pattern exactly rather than inventing a new one.
 */
export const CURRENT_VSCODE_RESTORE_VERSION = 1 as const;

/** A pending restore older than this is treated as expired — silently
 * discarded, never fired into a folder opened long after the restore
 * attempt that staged it was abandoned (VS Code never opened, crashed,
 * user cancelled). Generous for a slow cold start; tight enough that
 * "someone reopens this folder days later" definitely doesn't fire. */
const PENDING_RESTORE_TTL_MS = 5 * 60 * 1000;

/**
 * Mirrors Electron's app.getPath('userData') convention closely enough
 * for this feature, computable from a plain Node process (the VS Code
 * extension host) with no Electron dependency and no IPC. Windows is
 * the v1 target (claude.md's platform roadmap) so its branch matters
 * most; macOS/Linux are best-effort (Linux doesn't fully replicate
 * Electron's own XDG_CONFIG_HOME nuances) — acceptable now, worth
 * re-verifying against real Electron output when either is prioritized.
 */
export function getAppDataRootDir(): string {
  switch (process.platform) {
    case 'win32':
      return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), PRODUCT_NAME);
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', PRODUCT_NAME);
    case 'linux':
      return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), PRODUCT_NAME);
    default:
      throw new Error(
        `Unsupported platform for the VS Code restore data dir: "${process.platform}".`,
      );
  }
}

export function getVscodeRestoreDir(): string {
  return join(getAppDataRootDir(), 'vscode-restore');
}

/**
 * On win32, normalizes both the separator and the case before hashing;
 * elsewhere, only strips a trailing separator.
 *
 * Two Windows-only normalizations are both required, not just case:
 * Windows paths are case-insensitive (`C:\Projects\Foo` ==
 * `c:\projects\foo`), AND VS Code always reports an open folder's path
 * via `folder.uri.fsPath` using backslashes, regardless of how the
 * desktop app's own `path` field was typed (its UI placeholder text
 * itself uses forward slashes, e.g. "~/projects/client-c"). Without
 * normalizing the separator too, `C:/Projects/Foo` (as typed) and
 * `C:\Projects\Foo` (as VS Code reports it) hash to two different
 * files and the restore silently never fires — this is not a
 * hypothetical, it's the expected shape of ordinary user input on the
 * v1 target platform. Neither normalization is applied on macOS/Linux:
 * case-folding would wrongly conflate two distinct, case-sensitive
 * real folders, and backslash is a valid filename character there, not
 * a separator.
 */
function canonicalizeFolderPath(rawPath: string): string {
  if (process.platform === 'win32') {
    return rawPath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  }
  return rawPath.replace(/\/+$/, '');
}

function getPendingRestoreFilePath(absoluteFolderPath: string): string {
  const hash = createHash('sha256')
    .update(canonicalizeFolderPath(absoluteFolderPath))
    .digest('hex')
    .slice(0, 32);
  return join(getVscodeRestoreDir(), `restore-${hash}.json`);
}

/** One terminal's restore data — `commands` only, matching
 * docs/build-shell.md's literal Tier 1 scope. No `cwd` field: every
 * restored terminal's cwd is always the workspace folder itself
 * (extension.ts passes it explicitly) — adding a per-terminal override
 * would be scope not on the approved list. */
export const VscodeTerminalRestoreSchema = z.object({
  commands: z.array(z.string()),
});

export const VscodeRestoreEntrySchema = z.object({
  version: z.literal(CURRENT_VSCODE_RESTORE_VERSION),
  terminals: z.array(VscodeTerminalRestoreSchema).min(1),
  createdAt: z.string(),
});
export type VscodeRestoreEntry = z.infer<typeof VscodeRestoreEntrySchema>;

export async function writePendingVscodeRestore(
  absoluteFolderPath: string,
  entry: Omit<VscodeRestoreEntry, 'version' | 'createdAt'>,
): Promise<void> {
  const dir = getVscodeRestoreDir();
  await mkdir(dir, { recursive: true });
  // Best-effort hygiene, never blocks the actual write: a failed sweep
  // (e.g. a locked file on Windows) must not stop this restore from
  // being staged.
  await cleanupExpiredRestores().catch(() => {});
  const filePath = getPendingRestoreFilePath(absoluteFolderPath);
  const fullEntry: VscodeRestoreEntry = {
    version: CURRENT_VSCODE_RESTORE_VERSION,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  await writeFileAtomic(filePath, JSON.stringify(fullEntry, null, 2));
}

export type PendingVscodeRestoreResult =
  | { status: 'none' }
  | { status: 'found'; entry: VscodeRestoreEntry; filePath: string }
  | { status: 'expired'; filePath: string }
  | { status: 'unsupported-version'; version: unknown; filePath: string }
  | { status: 'corrupt'; error: string; filePath: string };

/**
 * Never throws. Order of checks: missing file -> 'none' (the
 * overwhelmingly common case, every ordinary folder-open); unparseable
 * JSON -> 'corrupt'; a version this build doesn't recognize ->
 * 'unsupported-version' (diagnosed distinctly — never guess-executed
 * against an unknown shape, file left in place for a compatible
 * version to consume later); a recognized-but-otherwise-invalid shape
 * -> 'corrupt'; older than the TTL -> 'expired' (treated as silently
 * as 'none' by callers, but distinguished here for logging).
 */
export async function readPendingVscodeRestore(
  absoluteFolderPath: string,
): Promise<PendingVscodeRestoreResult> {
  const filePath = getPendingRestoreFilePath(absoluteFolderPath);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'none' };
    }
    return { status: 'corrupt', error: err instanceof Error ? err.message : String(err), filePath };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: 'corrupt',
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
    };
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    parsed.version !== CURRENT_VSCODE_RESTORE_VERSION
  ) {
    return { status: 'unsupported-version', version: parsed.version, filePath };
  }

  const result = VscodeRestoreEntrySchema.safeParse(parsed);
  if (!result.success) {
    return { status: 'corrupt', error: result.error.message, filePath };
  }

  const ageMs = Date.now() - new Date(result.data.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > PENDING_RESTORE_TTL_MS) {
    return { status: 'expired', filePath };
  }

  return { status: 'found', entry: result.data, filePath };
}

/**
 * The reverse direction of the handoff above: the extension reports
 * which folder a window has open, the desktop app reads it — for "Save
 * my current workspace" detection (WCs/WC__save-current-workspace.md),
 * which needs a live "this VS Code window is open on this real folder"
 * signal, not just "VS Code is running somewhere." Mirrors the pending-
 * restore file's own hash-keyed naming exactly: VS Code can't open the
 * same folder in two windows simultaneously, so a folder-path-derived
 * key is already a correct per-window key, with no extra id scheme
 * needed and no risk of two open windows' files colliding.
 */
export const CURRENT_WINDOW_STATE_VERSION = 2 as const;

/**
 * How often the extension refreshes its "I'm still open" file while
 * running (extension.ts) — not a performance tuning knob, but what
 * bounds CURRENT_WINDOW_STATE_TTL_MS below. Refreshed on a timer, not
 * only on focus-change: a window the user never defocuses (works in it
 * for hours without alt-tabbing away) must not go stale just because no
 * focus event ever fired again.
 */
export const CURRENT_WINDOW_STATE_HEARTBEAT_MS = 60 * 1000;

/**
 * A heartbeat older than this is treated as stale — the window it
 * described may have closed, including via a crash or force-quit,
 * neither of which is guaranteed to run deactivate()'s own best-effort
 * cleanup below. 3x the heartbeat interval tolerates a slow or
 * momentarily-busy extension host missing a beat or two without a false
 * "closed" read.
 */
const CURRENT_WINDOW_STATE_TTL_MS = CURRENT_WINDOW_STATE_HEARTBEAT_MS * 3;

export function getCurrentWindowStateDir(): string {
  return join(getAppDataRootDir(), 'vscode-current-state');
}

function getCurrentWindowStateFilePath(absoluteFolderPath: string): string {
  const hash = createHash('sha256')
    .update(canonicalizeFolderPath(absoluteFolderPath))
    .digest('hex')
    .slice(0, 32);
  return join(getCurrentWindowStateDir(), `state-${hash}.json`);
}

// folderPath is stored in the content, not just encoded (one-way) into
// the filename hash — detection needs to ENUMERATE which folders are
// currently open (listOpenWindowFolders below), not just confirm a
// single candidate it already has a path for, and a hash can't be
// reversed back into the path that produced it.
/**
 * v2 adds what per-window resource tracking needs (WCs/
 * WC__window-tracking.md, slice 6): `sessionId` (vscode.env.sessionId —
 * unique per window, so a window closed and the folder reopened is a
 * different window), `activatedAt` (when this window's extension
 * started), `appRoot` (which VS Code-family app, e.g. Insiders) and
 * `folderCount` (multi-root windows are never tracked). v1 files, from
 * an older extension, still parse — they just can't be tracked.
 */
const CurrentWindowStateSchema = z.union([
  z.object({ version: z.literal(1), folderPath: z.string(), updatedAt: z.string() }),
  z.object({
    version: z.literal(2),
    folderPath: z.string(),
    updatedAt: z.string(),
    sessionId: z.string().min(1),
    activatedAt: z.string(),
    appRoot: z.string(),
    folderCount: z.number().int().nonnegative(),
  }),
]);

/** One live window, as its heartbeat reports it. */
export type WindowHeartbeat = z.infer<typeof CurrentWindowStateSchema>;

/** What a v2 heartbeat adds about its window — see CurrentWindowStateSchema. */
export interface WindowIdentityDetails {
  sessionId: string;
  activatedAt: string;
  appRoot: string;
  folderCount: number;
}

/**
 * Called by the extension on activation and on its heartbeat timer.
 * Never throws: a failed write just means this window won't be
 * recognized by detection (it falls back to a generic 'app' step),
 * never a broken extension.
 */
export async function writeCurrentWindowState(
  absoluteFolderPath: string,
  details: WindowIdentityDetails,
): Promise<void> {
  const dir = getCurrentWindowStateDir();
  await mkdir(dir, { recursive: true });
  const filePath = getCurrentWindowStateFilePath(absoluteFolderPath);
  const entry: WindowHeartbeat = {
    version: CURRENT_WINDOW_STATE_VERSION,
    folderPath: absoluteFolderPath,
    updatedAt: new Date().toISOString(),
    ...details,
  };
  await writeFileAtomic(filePath, JSON.stringify(entry));
}

export type CurrentWindowStateResult =
  { status: 'open'; updatedAt: string } | { status: 'stale' } | { status: 'none' };

function parseCurrentWindowStateFile(raw: string): WindowHeartbeat | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = CurrentWindowStateSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

function isFreshHeartbeat(updatedAt: string): boolean {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(ageMs) && ageMs <= CURRENT_WINDOW_STATE_TTL_MS;
}

/**
 * Read by the desktop app for a single, already-known candidate folder.
 * Degrades every failure (missing file, corrupt JSON, unrecognized
 * version) to 'none' — the same fail-soft contract as every other
 * best-effort detection read in this feature (e.g. chrome-profiles.ts's
 * getLastUsedChromeProfileFolder) — a window this can't confidently
 * confirm is open just falls back to the generic 'app' step, never a
 * thrown error mid-detection.
 */
export async function readCurrentWindowState(
  absoluteFolderPath: string,
): Promise<CurrentWindowStateResult> {
  const filePath = getCurrentWindowStateFilePath(absoluteFolderPath);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { status: 'none' };
  }

  const entry = parseCurrentWindowStateFile(raw);
  if (!entry) {
    return { status: 'none' };
  }

  return isFreshHeartbeat(entry.updatedAt)
    ? { status: 'open', updatedAt: entry.updatedAt }
    : { status: 'stale' };
}

/**
 * Every folder currently reported open by a live (non-stale) VS Code
 * window — what "Save my current workspace" detection actually needs:
 * discovering which folders are open, not just confirming one it
 * already has a path for. Sweeps every file in the directory; a
 * corrupt or stale entry is silently skipped, never thrown — the same
 * fail-soft contract as readCurrentWindowState. One entry per window by
 * construction (VS Code can't open the same folder in two windows at
 * once), so no further de-duplication is needed.
 */
export async function listOpenWindowFolders(): Promise<string[]> {
  return (await listWindowHeartbeats()).map((beat) => beat.folderPath);
}

/**
 * Every live (non-stale) window's heartbeat — what per-window resource
 * tracking reads to find, bind and check a VS Code window. Same
 * fail-soft contract as listOpenWindowFolders.
 */
export async function listWindowHeartbeats(): Promise<WindowHeartbeat[]> {
  let files: string[];
  try {
    files = await readdir(getCurrentWindowStateDir());
  } catch {
    return [];
  }

  const beats: WindowHeartbeat[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    let raw: string;
    try {
      raw = await readFile(join(getCurrentWindowStateDir(), file), 'utf-8');
    } catch {
      continue;
    }
    const entry = parseCurrentWindowStateFile(raw);
    if (entry && isFreshHeartbeat(entry.updatedAt)) {
      beats.push(entry);
    }
  }
  return beats;
}

/**
 * Best-effort cleanup, called by the extension's deactivate() — NOT
 * guaranteed to run on a crash/force-quit (the TTL above is the real
 * safety net; this is only tidiness for the ordinary close/reload path).
 * Idempotent — deleting an already-gone file is not an error.
 */
export async function deleteCurrentWindowState(absoluteFolderPath: string): Promise<void> {
  const filePath = getCurrentWindowStateFilePath(absoluteFolderPath);
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/** Idempotent — deleting an already-gone file is not an error. */
export async function deletePendingVscodeRestore(absoluteFolderPath: string): Promise<void> {
  const filePath = getPendingRestoreFilePath(absoluteFolderPath);
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Sweeps expired entries from the whole directory — called
 * opportunistically before staging a new restore, so a cancelled/
 * crashed restore's orphan file doesn't sit on disk forever. Purely
 * disk hygiene: correctness (never firing a stale restore) is already
 * guaranteed by readPendingVscodeRestore's own TTL check regardless of
 * whether this sweep ever runs.
 */
async function cleanupExpiredRestores(): Promise<void> {
  const dir = getVscodeRestoreDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, file), 'utf-8');
      const parsedJson: unknown = JSON.parse(raw);
      // Read createdAt straight off the raw JSON rather than requiring
      // it to pass the full current-version schema first. A file
      // written by a different app version is exactly as real a
      // possibility here as it is in readPendingVscodeRestore (see
      // decision 4) — and unlike that read path, this sweep has no
      // other mechanism to ever expire such a file: strict-schema
      // safeParse would reject it forever, leaving version-skewed (and
      // otherwise-malformed-but-JSON) orphans on disk permanently
      // instead of just past their TTL.
      const createdAt =
        typeof parsedJson === 'object' && parsedJson !== null && 'createdAt' in parsedJson
          ? (parsedJson as { createdAt: unknown }).createdAt
          : undefined;
      if (typeof createdAt !== 'string') continue;
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > PENDING_RESTORE_TTL_MS) {
        await unlink(join(dir, file)).catch(() => {});
      }
    } catch {
      // Unreadable/unparseable entries are left for readPendingVscodeRestore's
      // own per-file handling when/if something actually tries to consume them.
    }
  }
}
