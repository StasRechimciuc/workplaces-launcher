import { app } from 'electron';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  migrateWorkspaceConfig,
  parseWorkspaceConfig,
  type WorkspaceConfig,
} from '@workspace-launcher/shared';
import { writeFileAtomic } from '@workspace-launcher/shared/write-file-atomic';
import { KeyedLock } from '../lib/keyed-lock';

/**
 * Where workspace config JSON files actually live on disk, via
 * Electron's app.getPath('userData') — the correct, OS-appropriate
 * location on every platform (never a hardcoded path).
 */
export function getWorkspacesDir(): string {
  return join(app.getPath('userData'), 'workspaces');
}

export interface LoadWorkspacesResult {
  configs: WorkspaceConfig[];
  /** file name (or the workspaces directory itself) -> human-readable reason it failed to load. */
  errors: Record<string, string>;
}

/**
 * Reads every *.json file in the workspaces directory (in a stable,
 * deterministic order — sorted by filename, not whatever order the
 * filesystem happens to return) and validates each one against
 * WorkspaceConfigSchema. A single malformed file, a duplicate id, or
 * an inaccessible directory is reported by name, not thrown — one bad
 * config must never take down the whole workspace list (claude.md: no
 * silent failures, but also no unhandled exception for one bad file).
 */
export async function loadAllWorkspaceConfigs(): Promise<LoadWorkspacesResult> {
  const dir = getWorkspacesDir();
  const errors: Record<string, string> = {};

  let jsonFiles: string[];
  try {
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir);
    jsonFiles = entries.filter((entry) => entry.endsWith('.json')).sort();
  } catch (err) {
    errors[dir] =
      `Could not access the workspaces directory: ${err instanceof Error ? err.message : String(err)}`;
    return { configs: [], errors };
  }

  const configs: WorkspaceConfig[] = [];
  const fileById = new Map<string, string>();

  for (const file of jsonFiles) {
    try {
      const loaded = await loadConfigFile(dir, file);
      if (!loaded.ok) {
        errors[file] = loaded.error;
        continue;
      }
      const existingFile = fileById.get(loaded.config.id);
      if (existingFile) {
        errors[file] =
          `Duplicate workspace id "${loaded.config.id}" (already loaded from ${existingFile}) — skipped.`;
        continue;
      }

      fileById.set(loaded.config.id, file);
      configs.push(loaded.config);
    } catch (err) {
      errors[file] = err instanceof Error ? err.message : String(err);
    }
  }

  return { configs, errors };
}

type LoadedConfig = { ok: true; config: WorkspaceConfig } | { ok: false; error: string };

/** One migration per file at a time — see loadConfigFile. */
const migrationLock = new KeyedLock();

/**
 * One config file, migrated to the current format if it's older.
 *
 * Persisted before the config is used at all: a migration adds freshly
 * generated step ids, which have to be the same on the next load or
 * every tracked resource loses its step. So it runs once per file, under
 * a lock, re-reading the file inside it — two loads at once (a restore
 * and the workspace list) both get the ids the first one wrote, never
 * each their own. A config that can't be written back is skipped with a
 * loud error rather than run with ids that would change under it. The
 * original is kept alongside first (`<file>.v1.bak`, never overwritten,
 * and ignored by the *.json scan), so an upgrade can always be undone
 * by hand — an older build can't read the new format.
 */
async function loadConfigFile(dir: string, file: string): Promise<LoadedConfig> {
  const path = join(dir, file);
  const first = await readConfigFile(path);
  if (!first.migrated) return first.loaded;
  return migrationLock.withLocks([path], async () => {
    const current = await readConfigFile(path);
    if (!current.migrated || !current.loaded.ok) return current.loaded;
    try {
      await writeFile(join(dir, `${file}.v1.bak`), current.raw, { flag: 'wx' }).catch(
        (err: NodeJS.ErrnoException) => {
          if (err.code !== 'EEXIST') throw err;
        },
      );
      await writeFileAtomic(path, JSON.stringify(current.loaded.config, null, 2));
    } catch (err) {
      return {
        ok: false,
        error: `Upgraded this workspace's file format but couldn't save it: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return current.loaded;
  });
}

async function readConfigFile(
  path: string,
): Promise<{ raw: string; migrated: boolean; loaded: LoadedConfig }> {
  const raw = await readFile(path, 'utf-8');
  const { migrated, value } = migrateWorkspaceConfig(JSON.parse(raw));
  const parsed = parseWorkspaceConfig(value);
  return {
    raw,
    migrated,
    loaded: parsed.success
      ? { ok: true, config: parsed.config }
      : { ok: false, error: parsed.error },
  };
}

/**
 * Persists one workspace config to disk as `<id>.json`, creating the
 * workspaces directory if needed. Keyed by `config.id` rather than a
 * slugified name so: (a) renaming a workspace later never requires a
 * file rename/migration, and (b) a future "delete workspace by id"
 * operation is a one-line unlink(join(dir, `${id}.json`)) instead of
 * scanning every file to find a match.
 *
 * Uses writeFileAtomic so a crash mid-save can never leave a
 * truncated, unparseable config file that loadAllWorkspaceConfigs
 * would then report as an error on every future launch.
 */
export async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  const dir = getWorkspacesDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${config.id}.json`);
  await writeFileAtomic(filePath, JSON.stringify(config, null, 2));
}

/**
 * Removes `<id>.json` from the workspaces directory. Deleting an id
 * that has no file (ENOENT) is treated as success, not an error —
 * delete is idempotent by design: the caller's desired end state ("no
 * saved file for this id") is already true, so surfacing an error for
 * a file that's already gone would be a false alarm, not a bug report.
 * Any other fs error (permissions, disk issues, EISDIR, ...) is
 * rethrown untouched — a delete that was actually asked for and
 * silently failed to happen must never look like success.
 */
export async function deleteWorkspaceConfig(id: string): Promise<void> {
  const filePath = join(getWorkspacesDir(), `${id}.json`);
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
}
