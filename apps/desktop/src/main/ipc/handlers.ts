import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import type {
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  RestoreProgressEvent,
  StepResult,
  UpdateWorkspaceResult,
} from '@workspace-launcher/shared';
import {
  CURRENT_WORKSPACE_CONFIG_VERSION,
  parseWorkspaceConfig,
  RESTORE_PROGRESS_CHANNEL,
} from '@workspace-launcher/shared';
import { MOCK_WORKSPACES } from './mock-workspaces';
import { startRestoreFocusSession } from './restore-focus';
import { runWorkspace } from '../orchestrator/orchestrator';
import { validateStepsWithRegisteredTools } from '../tools/validate-steps';
import {
  deleteWorkspaceConfig,
  loadAllWorkspaceConfigs,
  saveWorkspaceConfig,
} from '../config/loader';
import { toWorkspaceDisplay } from '../config/workspace-display';
import type { WorkspaceDisplay } from '../../preload';

// The single source of truth for "is this id a placeholder, not a real
// saved workspace" — used both to tag WorkspaceDisplay.readOnly
// (listWorkspaces) and to independently re-verify, server-side, before
// mutating anything (updateWorkspace, deleteWorkspace). Never trust a
// renderer-supplied flag for this — same philosophy as createWorkspace's
// own validation never trusting the renderer's shape alone.
const MOCK_WORKSPACE_IDS = new Set(MOCK_WORKSPACES.map((ws) => ws.id));

function isMockWorkspaceId(id: string): boolean {
  return MOCK_WORKSPACE_IDS.has(id);
}

/**
 * Looks up a workspace by id — real saved configs first, then the mock
 * data — and runs it through the orchestrator. Kept separate from the
 * ipcMain.handle registration below so it's testable without mocking
 * Electron's ipcMain. `onProgress` is optional and Electron-free at
 * this layer too (it's just threaded through to runWorkspace) — the
 * actual IPC push and window-focus wiring live in registerIpcHandlers
 * below, where a real Electron `event`/BrowserWindow is available.
 */
export async function restoreWorkspace(
  workspaceId: unknown,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<StepResult[]> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:restore expects a workspace id (string).');
  }

  // Real, persisted configs take priority — the whole point of this
  // feature is that a saved workspace is genuinely restorable, not
  // just visible in the sidebar.
  const { configs } = await loadAllWorkspaceConfigs();
  const realConfig = configs.find((config) => config.id === workspaceId);
  if (realConfig) {
    return runWorkspace(realConfig, onProgress ? { onStepProgress: onProgress } : {});
  }

  const workspace = MOCK_WORKSPACES.find((ws) => ws.id === workspaceId);
  if (!workspace) {
    throw new Error(`No workspace found with id "${workspaceId}".`);
  }

  // Routed through the same parseWorkspaceConfig() gate config/loader.ts
  // uses for on-disk configs — this is currently the only call site
  // feeding the orchestrator, and keeping it on the one sanctioned
  // validation path (rather than trusting the mock data's shape by
  // construction) means it won't silently drift from
  // WorkspaceConfigSchema if that schema gains stricter rules later.
  const parsed = parseWorkspaceConfig({
    version: CURRENT_WORKSPACE_CONFIG_VERSION,
    id: workspace.id,
    name: workspace.name,
    steps: workspace.tools.map((tool) => ({ type: tool.type, params: tool.params })),
  });
  if (!parsed.success) {
    throw new Error(`Built an invalid workspace config for "${workspaceId}": ${parsed.error}`);
  }

  return runWorkspace(parsed.config, onProgress ? { onStepProgress: onProgress } : {});
}

/**
 * Validates and persists a new workspace, generating its id/version.
 * Two validation layers, in order:
 *  1. Schema (parseWorkspaceConfig) — structural correctness: name
 *     non-empty, steps well-formed.
 *  2. Per-step tool validation (validateStepsWithRegisteredTools) —
 *     only for step types that have a registered tool. A type with no
 *     tool yet is allowed through unvalidated: rejecting it would make
 *     it impossible to save a workspace using any preset besides VS
 *     Code, and the orchestrator already treats "no registered tool"
 *     as a normal, graceful per-step failure at restore time — never a
 *     crash — so allowing it to be saved is consistent, just applied
 *     earlier.
 *
 * Throws only for a call that isn't even the right basic shape (not an
 * object at all) — mirroring restoreWorkspace's own throw for a
 * wrong-shaped argument. A well-shaped-but-invalid workspace (empty
 * name, bad step params) is expected user input and comes back as
 * {success: false, error}, not a thrown exception.
 */
export async function createWorkspace(input: unknown): Promise<CreateWorkspaceResult> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('workspaces:create expects a { name, steps } object.');
  }
  const { name, steps } = input as { name?: unknown; steps?: unknown };

  const parsed = parseWorkspaceConfig({
    version: CURRENT_WORKSPACE_CONFIG_VERSION,
    id: randomUUID(),
    name,
    steps,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }

  const validationError = validateStepsWithRegisteredTools(parsed.config.steps);
  if (validationError) {
    return { success: false, error: validationError };
  }

  await saveWorkspaceConfig(parsed.config);
  return { success: true, config: parsed.config };
}

/**
 * Validates and overwrites an existing real workspace in place (its id
 * never changes). Rejects a mock id or an unknown id with a specific,
 * honest message before touching validation/disk at all. Reuses
 * saveWorkspaceConfig as-is — it already overwrites `<id>.json`
 * unconditionally.
 */
export async function updateWorkspace(input: unknown): Promise<UpdateWorkspaceResult> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('workspaces:update expects a { id, name, steps } object.');
  }
  const { id, name, steps } = input as { id?: unknown; name?: unknown; steps?: unknown };
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('workspaces:update expects a non-empty string "id".');
  }

  if (isMockWorkspaceId(id)) {
    return {
      success: false,
      error: `Cannot edit "${id}" — sample workspaces aren't saved to disk and can't be edited.`,
    };
  }

  const { configs } = await loadAllWorkspaceConfigs();
  if (!configs.some((config) => config.id === id)) {
    return { success: false, error: `No workspace found with id "${id}".` };
  }

  const parsed = parseWorkspaceConfig({
    version: CURRENT_WORKSPACE_CONFIG_VERSION,
    id,
    name,
    steps,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error };
  }

  const validationError = validateStepsWithRegisteredTools(parsed.config.steps);
  if (validationError) {
    return { success: false, error: validationError };
  }

  await saveWorkspaceConfig(parsed.config);
  return { success: true, config: parsed.config };
}

/**
 * Rejects a mock id or an unknown id with the same shape of honest
 * message updateWorkspace uses. Existence is checked here (not just
 * left to deleteWorkspaceConfig's own ENOENT-tolerance) specifically so
 * a *second* delete of the same real id reports "No workspace found"
 * rather than silently succeeding again — deleteWorkspaceConfig's own
 * idempotency is what makes it a safe, reusable loader primitive, not
 * what should shape this handler's user-facing behavior.
 */
export async function deleteWorkspace(workspaceId: unknown): Promise<DeleteWorkspaceResult> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('workspaces:delete expects a non-empty workspace id (string).');
  }

  if (isMockWorkspaceId(workspaceId)) {
    return {
      success: false,
      error: `Cannot delete "${workspaceId}" — sample workspaces aren't saved to disk and can't be deleted.`,
    };
  }

  const { configs } = await loadAllWorkspaceConfigs();
  if (!configs.some((config) => config.id === workspaceId)) {
    return { success: false, error: `No workspace found with id "${workspaceId}".` };
  }

  await deleteWorkspaceConfig(workspaceId);
  return { success: true };
}

/**
 * Real persisted workspaces first, then the mock demo data (see
 * mock-workspaces.ts — slated for full removal once every Tier 1 tool
 * is built), tagged `readOnly: true` so the renderer can hide/disable
 * Edit and Delete for them. A per-file load error (malformed JSON,
 * failed schema, duplicate id) is logged, not thrown or surfaced as a
 * total failure — loadAllWorkspaceConfigs already returns everything
 * that *did* load successfully, and one bad file shouldn't blank the
 * whole sidebar.
 */
export async function listWorkspaces(): Promise<WorkspaceDisplay[]> {
  const { configs, errors } = await loadAllWorkspaceConfigs();
  for (const [file, message] of Object.entries(errors)) {
    console.error(`Failed to load workspace config "${file}": ${message}`);
  }
  const realIds = new Set(configs.map((config) => config.id));
  return [
    ...configs.map(toWorkspaceDisplay),
    // Real, persisted configs always take priority — mirrors
    // restoreWorkspace's own real-before-mock precedence above.
    // Excluding a colliding mock id here (not just resolving it at
    // restore-time) avoids ever showing two list rows with the same
    // id, which would violate React's key uniqueness in Sidebar.tsx
    // and let a click land on either row unpredictably. Not reachable
    // through this app's own UI today (createWorkspace always mints a
    // fresh randomUUID()), but config-schema.ts's id regex doesn't
    // forbid a hand-placed or future-imported config from choosing one
    // of the hardcoded mock ids.
    ...MOCK_WORKSPACES.filter((ws) => !realIds.has(ws.id)).map((ws) => ({ ...ws, readOnly: true })),
  ];
}

/**
 * Registers every 'channel' the preload bridge is allowed to invoke.
 * This is the single place that decides what the renderer can ask the
 * main process to do — keep it a short, explicit list.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('workspaces:list', async () => {
    return listWorkspaces();
  });

  ipcMain.handle('workspaces:restore', async (event, workspaceId: unknown) => {
    // Derived on demand (this codebase's existing style — see
    // second-instance's BrowserWindow.getAllWindows()[0] in main/
    // index.ts — rather than caching a window reference in module
    // state). event.sender is exactly the webContents that invoked
    // this handler, so this is correct even if a future version ever
    // has more than one window.
    const win = BrowserWindow.fromWebContents(event.sender);
    const session = startRestoreFocusSession(win);
    try {
      return await restoreWorkspace(workspaceId, (progress) => {
        // A destroyed webContents (the user closed the window mid-
        // restore) makes .send() throw synchronously — that must never
        // propagate into the orchestrator's step loop and abort a
        // restore that's still correctly collecting results for steps
        // that already succeeded (orchestrator.ts's own no-discard
        // invariant).
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send(RESTORE_PROGRESS_CHANNEL, progress);
          }
        } catch (err) {
          console.error(
            `Failed to send restore progress: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // Same reasoning as the send() guard above: this callback runs
        // directly inside orchestrator.ts's step loop with nothing else
        // between it and runWorkspace's for-loop, so an uncaught throw
        // here (e.g. an unexpected native error from moveTop()/focus())
        // would abort the whole restore, not just this progress update.
        try {
          session.reassert(progress);
        } catch (err) {
          console.error(
            `Failed to reassert restore focus: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    } finally {
      session.end();
    }
  });

  ipcMain.handle('workspaces:create', async (_event, input: unknown) => {
    return createWorkspace(input);
  });

  ipcMain.handle('workspaces:update', async (_event, input: unknown) => {
    return updateWorkspace(input);
  });

  ipcMain.handle('workspaces:delete', async (_event, workspaceId: unknown) => {
    return deleteWorkspace(workspaceId);
  });
}
