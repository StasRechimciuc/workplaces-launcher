import { contextBridge, ipcRenderer } from 'electron';
import type { StepResult } from '@workspace-launcher/shared';

/**
 * One step in a workspace's restore timeline, as shown in the detail
 * view. Carries both what's displayed (icon, color, human-readable
 * timing) and what actually runs (type/params — the same shape as
 * WorkspaceStep in @workspace-launcher/shared) — see
 * src/main/ipc/mock-workspaces.ts. The display and executable halves
 * converge once the UI is driven by real persisted configs instead of
 * this mock data (Tier 1 feature work: saving a created workspace).
 */
export interface WorkspaceToolStepDisplay {
  icon: string;
  color: string;
  name: string;
  time: string;
  detail: string;
  expand?: { i: string; label: string; mono?: string }[];
  /** The tool type this step actually runs as — looked up in the tool registry. */
  type: string;
  /** Params passed to that tool's validate()/run(). */
  params: Record<string, unknown>;
}

export interface WorkspaceDisplay {
  id: string;
  name: string;
  tag: string;
  subtitle: string;
  description: string;
  lastRestored: string;
  restoreTime: string;
  tools: WorkspaceToolStepDisplay[];
}

/**
 * The only surface the renderer can reach into the main process
 * through (contextIsolation is on, nodeIntegration is off — see
 * src/main/index.ts). Deliberately narrow and explicitly named: no raw
 * ipcRenderer, no generic "invoke(channel, ...args)" passthrough. Add a
 * new method here only when the renderer genuinely needs a new
 * capability.
 */
const api = {
  listWorkspaces: (): Promise<WorkspaceDisplay[]> => ipcRenderer.invoke('workspaces:list'),
  restoreWorkspace: (workspaceId: string): Promise<StepResult[]> =>
    ipcRenderer.invoke('workspaces:restore', workspaceId),
};

export type WorkspaceLauncherApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
