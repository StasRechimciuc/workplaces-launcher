import { app } from 'electron';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWorkspaceConfig, type WorkspaceConfig } from '@workspace-launcher/shared';

/**
 * Where workspace config JSON files actually live on disk, via
 * Electron's app.getPath('userData') — the correct, OS-appropriate
 * location on every platform (never a hardcoded path). Not yet wired
 * into the UI (see src/main/ipc/handlers.ts and
 * src/main/ipc/mock-workspaces.ts) — that wiring is Tier 1 feature
 * work. This module exists now so the config schema, validation, and
 * on-disk convention are settled before feature work builds on them.
 */
function getWorkspacesDir(): string {
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
