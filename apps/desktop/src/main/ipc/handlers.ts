import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type {
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  StepResult,
  UpdateWorkspaceResult,
  WorkspaceStep,
} from '@workspace-launcher/shared';
import { CURRENT_WORKSPACE_CONFIG_VERSION, parseWorkspaceConfig } from '@workspace-launcher/shared';
import { MOCK_WORKSPACES } from './mock-workspaces';
import { runWorkspace } from '../orchestrator/orchestrator';
import { getTool } from '../tools/registry';
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
 * Runs each step's params through its registered tool's own validate()
 * (docs/architecture.md #2) — the second, trusted-side validation layer
 * both createWorkspace and updateWorkspace need identically. A step
 * type with no registered tool yet is intentionally allowed through
 * unvalidated, same as createWorkspace always did.
 */
function validateStepsWithRegisteredTools(steps: WorkspaceStep[]): string | null {
  for (const step of steps) {
    const tool = getTool(step.type);
    if (!tool) {
      continue;
    }
    const validation = tool.validate(step.params);
    if (!validation.valid) {
      return `Invalid params for step type "${step.type}": ${validation.errors.join(', ')}`;
    }
  }
  return null;
}

/**
 * Looks up a workspace by id — real saved configs first, then the mock
 * data — and runs it through the orchestrator. Kept separate from the
 * ipcMain.handle registration below so it's testable without mocking
 * Electron's ipcMain.
 */
export async function restoreWorkspace(workspaceId: unknown): Promise<StepResult[]> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:restore expects a workspace id (string).');
  }

  // Real, persisted configs take priority — the whole point of this
  // feature is that a saved workspace is genuinely restorable, not
  // just visible in the sidebar.
  const { configs } = await loadAllWorkspaceConfigs();
  const realConfig = configs.find((config) => config.id === workspaceId);
  if (realConfig) {
    return runWorkspace(realConfig);
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

  return runWorkspace(parsed.config);
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

  ipcMain.handle('workspaces:restore', async (_event, workspaceId: unknown) => {
    return restoreWorkspace(workspaceId);
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
