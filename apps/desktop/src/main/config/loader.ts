import { app } from 'electron';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWorkspaceConfig, type WorkspaceConfig } from '@workspace-launcher/shared';
import { writeFileAtomic } from '@workspace-launcher/shared/write-file-atomic';

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
      const raw = await readFile(join(dir, file), 'utf-8');
      const parsed = parseWorkspaceConfig(JSON.parse(raw));
      if (!parsed.success) {
        errors[file] = parsed.error;
        continue;
      }

      const existingFile = fileById.get(parsed.config.id);
      if (existingFile) {
        errors[file] =
          `Duplicate workspace id "${parsed.config.id}" (already loaded from ${existingFile}) — skipped.`;
        continue;
      }

      fileById.set(parsed.config.id, file);
      configs.push(parsed.config);
    } catch (err) {
      errors[file] = err instanceof Error ? err.message : String(err);
    }
  }

  return { configs, errors };
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
