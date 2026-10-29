import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccessibilityStatus,
  ApplyStepsChangeResult,
  ChromeListProfilesResult,
  CloseResult,
  CreateWorkspaceInput,
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  DetectAppResult,
  DetectProjectFilesResult,
  DetectWorkspaceDraftResult,
  GetLaunchOnLoginResult,
  OpenAccessibilitySettingsResult,
  SetHotkeyBindingResult,
  SetLaunchOnLoginResult,
  SpotifyConnectResult,
  SpotifyListPlaylistsResult,
  SpotifyStatus,
  StepResult,
  SwitchResult,
  ToolAppKey,
  UpdateWorkspaceInput,
  UpdateWorkspaceResult,
  WorkspaceStepInput,
} from '@workspace-launcher/shared';
// Deliberately NOT from the '@workspace-launcher/shared' barrel — see
// that package's index.ts for why a value import through it would drag
// zod into this sandboxed preload's require() and crash it silently.
import { RESTORE_PROGRESS_CHANNEL } from '@workspace-launcher/shared/restore-progress';
import type { RestoreProgressEvent } from '@workspace-launcher/shared/restore-progress';
import { SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL } from '@workspace-launcher/shared/save-current-workspace-channel';

/**
 * Pre-formatted launch-time display for one step or a whole workspace —
 * `display` is ready to render as-is (the renderer interpolates it
 * directly and never re-parses or pattern-matches it); `state` is the
 * only thing branching logic (tooltip/suffix choice) keys off. Replaces
 * the old '0s' / '—' sentinel-string conventions, matching this
 * codebase's existing string-literal-union idiom for exactly this shape
 * (see LeftOpenEntry.reason in @workspace-launcher/shared).
 *
 * - 'no-steps': the workspace has zero steps — nothing to time
 *   (workspace-level only).
 * - 'unmeasured': fewer than 3 historical samples exist yet for every
 *   relevant step type.
 * - 'partial': some but not all of a workspace's steps have enough
 *   history (workspace-level only).
 * - 'full': enough history exists for a clean estimate.
 *
 * A single step (TimelineStep.tsx) only ever produces 'unmeasured' |
 * 'full' in practice — 'no-steps'/'partial' are workspace-level-only
 * outcomes, but the type is shared so both sides can defensively
 * exhaust all four without a second parallel type.
 */
export interface TimingDisplay {
  display: string;
  state: 'no-steps' | 'unmeasured' | 'partial' | 'full';
}

/**
 * One step in a workspace's restore timeline, as shown in the detail
 * view. Carries both what's displayed (icon, color, human-readable
 * timing) and what actually runs (type/params — the same shape as
 * WorkspaceStep in @workspace-launcher/shared) — see
 * src/main/config/workspace-display.ts's toWorkspaceDisplay.
 */
export interface WorkspaceToolStepDisplay {
  /** The step's stable id (WorkspaceStep.id) — echoed back on save so
   * an edit keeps it; see StepIdSchema in @workspace-launcher/shared. */
  id: string;
  icon: string;
  color: string;
  name: string;
  launchTime: TimingDisplay;
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
  launchTime: TimingDisplay;
  tools: WorkspaceToolStepDisplay[];
  /**
   * Explicitly Restored/Switched-to and not yet Closed, AND something
   * it needs is actually still running (see
   * WCs/WC__workspace-activity.md) — always false/absent on any
   * platform but macOS (v1 scope). Optional/computed: absent in
   * `toWorkspaceDisplay`'s own return type, always present once
   * `listWorkspaces()` is done with it.
   */
  active?: boolean;
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
  // Re-runs exactly one step of an already-restored workspace — the
  // Detail view's per-failed-step Retry button. Deliberately lighter
  // than restoreWorkspace: no onRestoreProgress events fire for this,
  // since retry only runs after a restore has already finished.
  retryWorkspaceStep: (workspaceId: string, stepIndex: number): Promise<StepResult> =>
    ipcRenderer.invoke('workspaces:retryStep', workspaceId, stepIndex),
  createWorkspace: (input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:create', input),
  updateWorkspace: (input: UpdateWorkspaceInput): Promise<UpdateWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:update', input),
  deleteWorkspace: (workspaceId: string): Promise<DeleteWorkspaceResult> =>
    ipcRenderer.invoke('workspaces:delete', workspaceId),
  // Full context change: closes whatever's running that this workspace
  // doesn't need, then restores it — see orchestrator.ts's
  // switchToWorkspace. macOS-only v1; a no-op elsewhere that still
  // restores (WorkspaceDisplay.active is always false off-macOS, so
  // the renderer never shows this button there).
  switchToWorkspace: (workspaceId: string): Promise<SwitchResult> =>
    ipcRenderer.invoke('workspaces:switchTo', workspaceId),
  // What saving these (unsaved, draft) steps would close right now —
  // empty means save without asking. See orchestrator.ts's
  // previewStepsChange.
  previewStepsChange: (workspaceId: string, steps: WorkspaceStepInput[]): Promise<string[]> =>
    ipcRenderer.invoke('workspaces:previewStepsChange', workspaceId, steps),
  // Called right after saving an edit: releases what removed/changed
  // steps held (closing it with `close`) and re-runs changed steps.
  applyStepsChange: (workspaceId: string, close: boolean): Promise<ApplyStepsChangeResult> =>
    ipcRenderer.invoke('workspaces:applyStepsChange', workspaceId, close),
  // Closes only this workspace's own apps — see orchestrator.ts's
  // closeWorkspace. macOS-only v1.
  closeWorkspace: (workspaceId: string): Promise<CloseResult> =>
    ipcRenderer.invoke('workspaces:close', workspaceId),
  // Resolves to the picked folder's absolute path, or null if the user
  // cancelled the native dialog.
  selectProjectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectProjectFolder'),
  // Resolves to the picked .app bundle's absolute path, or null if the
  // user cancelled — the generic "App" step type's only input.
  selectApp: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectApp'),
  // Resolves to the picked file's absolute path, or null if the user
  // cancelled — no extension filter, unlike selectApp above. The
  // "File or Link" step type's Browse… button.
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFile'),
  // Opens the system browser to Spotify's consent page and resolves
  // once the OAuth round trip completes (or fails) — see
  // main/spotify/auth.ts's connect().
  connectSpotify: (): Promise<SpotifyConnectResult> => ipcRenderer.invoke('spotify:connect'),
  // Cheap, no-network — reads the persisted token store only.
  getSpotifyStatus: (): Promise<SpotifyStatus> => ipcRenderer.invoke('spotify:status'),
  disconnectSpotify: (): Promise<void> => ipcRenderer.invoke('spotify:disconnect'),
  listSpotifyPlaylists: (): Promise<SpotifyListPlaylistsResult> =>
    ipcRenderer.invoke('spotify:listPlaylists'),
  // Reads Chrome's own Local State file — no network, no connection
  // state, just a local file read (see main/platform/chrome-profiles.ts).
  listChromeProfiles: (): Promise<ChromeListProfilesResult> =>
    ipcRenderer.invoke('chrome:listProfiles'),
  // Resolves to a data URL of the given .app bundle's own real icon, or
  // null if it can't be read (app moved/deleted, or any other failure)
  // — the generic "App" step type's badge (see lib/useAppIcon.ts).
  getAppIcon: (appPath: string): Promise<string | null> =>
    ipcRenderer.invoke('app:getIcon', appPath),
  // Scans this machine for a real installed .app matching the given
  // built-in tool type (never a single silently-picked winner — always
  // the full candidate list) — see main/platform/app-detection.ts.
  // Always a live scan, never a stale cached answer (see
  // app-detection-cache.ts's rescanAndCache doc comment). Always
  // resolves `{success:true, candidates:[]}` on a platform without
  // real detection support (Windows, for now) rather than failing —
  // the renderer's existing "0 candidates" flow (the native app-picker)
  // already covers that case.
  detectInstalledApp: (toolKey: ToolAppKey): Promise<DetectAppResult> =>
    ipcRenderer.invoke('app:detectInstalls', toolKey),
  // Checks a directory for a Compose file / Tiltfile — see
  // docker-fields.tsx / lib/useProjectFilesDetection.ts for how this
  // drives auto-selecting the Compose/Tilt engine toggle.
  detectProjectFiles: (directory: string): Promise<DetectProjectFilesResult> =>
    ipcRenderer.invoke('fs:detectProjectFiles', directory),
  // The workspace's own base accelerator (fires Restore) — undefined if
  // none is set. The Shift variant (fires Switch) is always derived
  // from this, never a separate stored value — see
  // WCs/WC__global-hotkeys.md.
  getWorkspaceHotkey: (workspaceId: string): Promise<string | undefined> =>
    ipcRenderer.invoke('hotkeys:getBinding', workspaceId),
  getAllWorkspaceHotkeys: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('hotkeys:getAllBindings'),
  // Re-registers live with the OS as part of this call — a rejected
  // combo (already in use, by this app or another) never gets
  // persisted, see ipc/handlers.ts's setWorkspaceHotkey.
  setWorkspaceHotkey: (workspaceId: string, accelerator: string): Promise<SetHotkeyBindingResult> =>
    ipcRenderer.invoke('hotkeys:setBinding', workspaceId, accelerator),
  clearWorkspaceHotkey: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('hotkeys:clearBinding', workspaceId),
  // Workspace ids whose hotkey failed to (re-)register on the most
  // recent sync (e.g. a macOS update changed what owns a combo) — the
  // Settings UI's "needs to be re-picked" indicator.
  getFailedWorkspaceHotkeys: (): Promise<string[]> =>
    ipcRenderer.invoke('hotkeys:getFailedBindings'),
  // Always a live read of the OS's own login-item state — see
  // ipc/handlers.ts's getLaunchOnLogin.
  getLaunchOnLogin: (): Promise<GetLaunchOnLoginResult> =>
    ipcRenderer.invoke('settings:getLaunchOnLogin'),
  setLaunchOnLogin: (value: boolean): Promise<SetLaunchOnLoginResult> =>
    ipcRenderer.invoke('settings:setLaunchOnLogin', value),
  // A fresh `wl-helper trust` on every call — never cached, see
  // AccessibilityStatus in @workspace-launcher/shared. The onboarding
  // modal polls this once a second while it's open.
  getAccessibilityStatus: (): Promise<AccessibilityStatus> =>
    ipcRenderer.invoke('accessibility:getStatus'),
  // System Settings at Privacy & Security → Accessibility.
  openAccessibilitySettings: (): Promise<OpenAccessibilitySettingsResult> =>
    ipcRenderer.invoke('accessibility:openSettings'),
  // "Continue without" on the first-launch modal — it's never forced
  // again; the banner and Settings row offer the same flow from then on.
  completeAccessibilityOnboarding: (): Promise<void> =>
    ipcRenderer.invoke('accessibility:completeOnboarding'),
  // The single, app-wide "Save current workspace" accelerator — no
  // workspace id (there's only ever one), no Shift-derived variant
  // (no Restore/Switch duality for this action) — see
  // WCs/WC__save-current-workspace.md.
  getAppHotkey: (): Promise<string | undefined> => ipcRenderer.invoke('hotkeys:getAppHotkey'),
  setAppHotkey: (accelerator: string): Promise<SetHotkeyBindingResult> =>
    ipcRenderer.invoke('hotkeys:setAppHotkey', accelerator),
  clearAppHotkey: (): Promise<void> => ipcRenderer.invoke('hotkeys:clearAppHotkey'),
  getAppHotkeyFailed: (): Promise<boolean> => ipcRenderer.invoke('hotkeys:getAppHotkeyFailed'),
  // Runs a detection pass over everything currently open/running and
  // returns a DRAFT only — nothing is saved until the renderer's review
  // screen calls createWorkspace itself with what the user confirmed.
  detectCurrentWorkspace: (): Promise<DetectWorkspaceDraftResult> =>
    ipcRenderer.invoke('workspaces:detectCurrent'),
  // Marks a freshly detected-and-saved workspace as currently active —
  // see ipc/handlers.ts's markWorkspaceActive. Called by the review
  // screen right after a successful createWorkspace, never by the
  // ordinary manual "New workspace" flow.
  markWorkspaceActive: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('workspaces:markActive', workspaceId),
  // One-directional main -> renderer push: the "Save current workspace"
  // hotkey (or its tray-menu companion) fired — open the review screen.
  // No payload; the renderer calls detectCurrentWorkspace() itself in
  // response. Same unsubscribe-function shape as onRestoreProgress above.
  onSaveCurrentWorkspaceTriggered: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL, listener);
  },
};

export type WorkspaceLauncherApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
