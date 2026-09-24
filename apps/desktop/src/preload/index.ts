import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateWorkspaceInput,
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  StepResult,
  UpdateWorkspaceInput,
  UpdateWorkspaceResult,
} from '@workspace-launcher/shared';
// Deliberately NOT from the '@workspace-launcher/shared' barrel — see
// that package's index.ts for why a value import through it would drag
// zod into this sandboxed preload's require() and crash it silently.
import { RESTORE_PROGRESS_CHANNEL } from '@workspace-launcher/shared/restore-progress';
import type { RestoreProgressEvent } from '@workspace-launcher/shared/restore-progress';

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
  /**
   * True for placeholder/mock workspaces (ipc/mock-workspaces.ts) with
   * no backing file on disk — Edit/Delete are unavailable for these.
   * Absent/false means a real, persisted workspace. Display-only: never
   * sent back over IPC as update/delete input, and never trusted by the
   * main process for the actual mutation (see handlers.ts's
   * isMockWorkspaceId, which independently re-derives this).
   */
  readOnly?: boolean;
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
  // Plain sync property, not an IPC round trip — process.platform is
  // available directly in a sandboxed preload script (Electron's
  // documented subset of Node globals it still exposes there). The
  // renderer needs this for exactly one thing: which side of the
  // custom title bar to reserve space on for the real OS window
  // controls (top-left traffic lights on darwin via
  // trafficLightPosition, top-right titleBarOverlay buttons
  // everywhere else — see main/index.ts's windowFrameOptions).
  platform: process.platform,
  listWorkspaces: (): Promise<WorkspaceDisplay[]> => ipcRenderer.invoke('workspaces:list'),
  restoreWorkspace: (workspaceId: string): Promise<StepResult[]> =>
    ipcRenderer.invoke('workspaces:restore', workspaceId),
  // First one-directional main→renderer subscription in this codebase
  // (no prior ipcRenderer.on precedent to follow) — returns an
  // unsubscribe function rather than requiring the caller to manage
  // the listener reference directly, so a component can clean up in
  // one line the same way it already does for its other effects.
  onRestoreProgress: (callback: (event: RestoreProgressEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: RestoreProgressEvent): void =>
      callback(event);
    ipcRenderer.on(RESTORE_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(RESTORE_PROGRESS_CHANNEL, listener);
  },
  createWorkspace: (input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:create', input),
  updateWorkspace: (input: UpdateWorkspaceInput): Promise<UpdateWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:update', input),
  deleteWorkspace: (workspaceId: string): Promise<DeleteWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:delete', workspaceId),
};

export type WorkspaceLauncherApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
