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

async function ensureWorkspacesDir(): Promise<string> {
  const dir = getWorkspacesDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface LoadWorkspacesResult {
  configs: WorkspaceConfig[];
  /** file name -> human-readable reason it failed to load. */
  errors: Record<string, string>;
}

/**
 * Reads every *.json file in the workspaces directory and validates
 * each one against WorkspaceConfigSchema. A single malformed file is
 * reported by name, not thrown — one bad config must never take down
 * the whole workspace list (claude.md: no silent failures, but also no
 * unhandled exception for one bad file).
 */
export async function loadAllWorkspaceConfigs(): Promise<LoadWorkspacesResult> {
  const dir = await ensureWorkspacesDir();
  const entries = await readdir(dir);
  const jsonFiles = entries.filter((entry) => entry.endsWith('.json'));

  const configs: WorkspaceConfig[] = [];
  const errors: Record<string, string> = {};

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8');
      const parsed = parseWorkspaceConfig(JSON.parse(raw));
      if (parsed.success) {
        configs.push(parsed.config);
      } else {
        errors[file] = parsed.error;
      }
    } catch (err) {
      errors[file] = err instanceof Error ? err.message : String(err);
    }
  }

  return { configs, errors };
}
