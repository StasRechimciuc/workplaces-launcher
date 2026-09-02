import { contextBridge, ipcRenderer } from 'electron';

/**
 * One step in a workspace's restore timeline, as shown in the detail
 * view. This is display/UI data (icon, color, human-readable timing) —
 * distinct from WorkspaceStep in @workspace-launcher/shared, which is
 * the real, executable step the orchestrator runs. The two converge
 * once the UI is driven by real persisted configs instead of the mock
 * data below (Tier 1 feature work, not boilerplate).
 */
export interface WorkspaceToolStepDisplay {
  icon: string;
  color: string;
  name: string;
  time: string;
  detail: string;
  expand?: { i: string; label: string; mono?: string }[];
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
};

export type WorkspaceLauncherApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
