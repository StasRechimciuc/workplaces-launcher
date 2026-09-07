import { ipcMain } from 'electron';
import type { StepResult } from '@workspace-launcher/shared';
import { parseWorkspaceConfig } from '@workspace-launcher/shared';
import { MOCK_WORKSPACES } from './mock-workspaces';
import { runWorkspace } from '../orchestrator/orchestrator';

/**
 * Looks up a workspace by id in the mock data and runs it through the
 * orchestrator. Kept separate from the ipcMain.handle registration
 * below so it's testable without mocking Electron's ipcMain.
 */
export async function restoreWorkspace(workspaceId: unknown): Promise<StepResult[]> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:restore expects a workspace id (string).');
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
    version: 1,
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
 * Registers every 'channel' the preload bridge is allowed to invoke.
 * This is the single place that decides what the renderer can ask the
 * main process to do — keep it a short, explicit list.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('workspaces:list', async () => {
    return MOCK_WORKSPACES;
  });

  ipcMain.handle('workspaces:restore', async (_event, workspaceId: unknown) => {
    return restoreWorkspace(workspaceId);
  });
}
