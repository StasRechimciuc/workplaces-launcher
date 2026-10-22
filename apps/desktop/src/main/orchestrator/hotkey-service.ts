import { BrowserWindow, globalShortcut, Notification } from 'electron';
import { isWellFormedAccelerator, switchAccelerator } from '@workspace-launcher/shared';
import { SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL } from '@workspace-launcher/shared/save-current-workspace-channel';
import { getAllHotkeyBindings } from './workspace-hotkeys-store';
import { getSaveCurrentWorkspaceHotkey } from './app-hotkeys-store';
import { getWorkspaceName, restoreWorkspaceWithFocus, switchWorkspace } from '../ipc/handlers';

/**
 * Owns the live OS-level registration of every workspace's global
 * hotkey (see WCs/WC__global-hotkeys.md). syncHotkeys() is the single
 * chokepoint: it fully unregisters and re-registers from the current
 * stored bindings, rather than trying to track incremental add/remove
 * — simpler, and the only call in this file's test coverage needs to
 * reason about.
 *
 * Called: once at app startup (main/index.ts's whenReady), after every
 * hotkey binding create/clear (ipc/handlers.ts), and after a workspace
 * itself is deleted.
 */

/** Workspace ids whose binding failed to (re-)register on the most
 * recent syncHotkeys() pass — read by the Settings UI's "needs to be
 * re-picked" indicator (hotkeys:getFailedBindings). In-memory only,
 * never persisted: syncHotkeys() always re-runs fresh at every app
 * launch, so there's nothing stale to recover across a restart. */
let lastFailedWorkspaceIds: string[] = [];

/** Workspaces currently mid-restore/switch from a hotkey trigger —
 * ignores a second press for the same workspace while one is already
 * running, rather than firing a second, overlapping orchestrator run
 * (e.g. a double-tap, or someone holding a key combo down). */
const inFlight = new Set<string>();

/** Whether the app-level "Save current workspace" accelerator failed
 * to (re-)register on the most recent syncHotkeys() pass — kept
 * separate from lastFailedWorkspaceIds above (a workspace-id-typed
 * array) since this failure has no workspace id to report under; a
 * workspace-keyed Settings-UI indicator isn't the right place for it. */
let lastAppHotkeyFailed = false;

/**
 * Lets main/index.ts hand this module a way to show/focus/create the
 * main window — needed because "Save current workspace" firing with no
 * window open must still show the review screen (unlike a plain
 * Restore, which degrades gracefully with nothing to show). The actual
 * show/focus/create logic (showOrCreateMainWindow) lives in index.ts's
 * own closure; this module must never import FROM index.ts instead,
 * since index.ts already imports this module to call syncHotkeys() at
 * startup — a reverse import would be circular.
 */
let showMainWindow: (() => void) | undefined;

export function registerShowMainWindow(fn: () => void): void {
  showMainWindow = fn;
}

/**
 * Registers one accelerator. `globalShortcut.register()`'s own boolean
 * return value already reports "another app/the OS silently refused
 * this" (per Electron's docs: "whether or not the shortcut was
 * registered successfully" — a silent OS-level refusal returns `false`,
 * it does not throw); this also guards against the rarer case of an
 * unparsable accelerator string actually throwing, contained per-
 * registration so one bad combo can never abort the whole sync pass.
 */
function registerOne(accelerator: string, callback: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, callback);
  } catch (err) {
    console.error(
      `Failed to register hotkey "${accelerator}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function notifyFailure(workspaceId: string, action: 'Restore' | 'Switch', detail: string): void {
  // There's no window necessarily open to show this in (the whole
  // point of a global hotkey) — a native notification is the only
  // feedback channel available. Deliberately only for FAILURE: the
  // launched apps themselves are the confirmation on success, and a
  // founder-predicted "used a lot" feature shouldn't toast on every
  // ordinary success.
  if (!Notification.isSupported()) return;
  void getWorkspaceName(workspaceId).then((name) => {
    new Notification({ title: `${action} failed — ${name}`, body: detail }).show();
  });
}

async function runHotkeyTrigger(workspaceId: string, action: 'restore' | 'switch'): Promise<void> {
  if (inFlight.has(workspaceId)) return; // debounce — already running
  inFlight.add(workspaceId);
  try {
    if (action === 'restore') {
      // The window, if one exists, still gets the same always-on-top
      // focus-pin + live progress push a click of the Restore button
      // would give it — a hotkey fired while the app happens to be
      // visible shouldn't be a degraded experience. If no window
      // exists, restoreWorkspaceWithFocus degrades gracefully (nothing
      // to pin, nothing to push progress to).
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const results = await restoreWorkspaceWithFocus(workspaceId, win);
      const failed = results.find((r) => !r.success);
      if (failed) notifyFailure(workspaceId, 'Restore', failed.message);
    } else {
      // Mirrors the existing Switch button's own IPC handler exactly —
      // that handler has no focus/progress wiring either today, so
      // there's no gap to close here the way there was for Restore.
      const result = await switchWorkspace(workspaceId);
      const failed = result.stepResults.find((r) => !r.success);
      if (failed) notifyFailure(workspaceId, 'Switch', failed.message);
    }
  } catch (err) {
    notifyFailure(
      workspaceId,
      action === 'restore' ? 'Restore' : 'Switch',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    inFlight.delete(workspaceId);
  }
}

/**
 * Fires on the single app-level accelerator — shows/focuses (or
 * creates) the main window, then pushes an IPC event telling the
 * renderer to open the "Save current workspace" review screen. The
 * renderer fetches the actual draft itself (via a separate
 * `workspaces:detectCurrent` call) rather than this push carrying it,
 * same reasoning as every other "something happened, go ask for the
 * detail" push in this app.
 */
function runSaveCurrentWorkspaceTrigger(): void {
  showMainWindow?.();
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    // Nothing to notify — same silent-degradation contract as every
    // other trigger here when there's genuinely no window to reach.
    return;
  }
  try {
    win.webContents.send(SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL);
  } catch (err) {
    console.error(
      `Failed to notify the renderer of the save-current-workspace trigger: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Re-registers every stored binding's base accelerator (fires Restore)
 * and its derived Shift variant (fires Switch) as live global
 * shortcuts, plus the single app-level "Save current workspace"
 * accelerator — all in the same pass, since globalShortcut.unregisterAll()
 * wipes every registration this process owns, not just the per-workspace
 * ones; two independent passes would have the second silently undo the
 * first's work. Never leaves a workspace with only one of its pair
 * registered: if either fails, both are unregistered for that
 * workspace and its id is reported in `failed`, so a workspace never
 * silently ends up with a half-working hotkey. The app-level
 * accelerator's own failure is reported separately via
 * `appHotkeyFailed` — it has no workspace id to report under.
 */
export function syncHotkeys(): { failed: string[]; appHotkeyFailed: boolean } {
  globalShortcut.unregisterAll();
  const bindings = getAllHotkeyBindings();
  const failed: string[] = [];

  for (const [workspaceId, base] of Object.entries(bindings)) {
    // Re-validated independently of the renderer's own recorder
    // constraints — a stored binding could in principle reach this
    // point from a hand-edited electron-store JSON file, not just the
    // trusted in-app recorder.
    if (!isWellFormedAccelerator(base, { allowShift: false })) {
      console.error(`Skipping malformed stored hotkey for workspace "${workspaceId}": "${base}".`);
      failed.push(workspaceId);
      continue;
    }

    const switchCombo = switchAccelerator(base);
    const baseOk = registerOne(base, () => {
      void runHotkeyTrigger(workspaceId, 'restore');
    });
    const switchOk = registerOne(switchCombo, () => {
      void runHotkeyTrigger(workspaceId, 'switch');
    });

    if (!baseOk || !switchOk) {
      if (baseOk) globalShortcut.unregister(base);
      if (switchOk) globalShortcut.unregister(switchCombo);
      failed.push(workspaceId);
    }
  }

  let appHotkeyFailed = false;
  const appHotkey = getSaveCurrentWorkspaceHotkey();
  if (appHotkey !== undefined) {
    if (!isWellFormedAccelerator(appHotkey, { allowShift: true })) {
      console.error(`Skipping malformed stored app-level hotkey: "${appHotkey}".`);
      appHotkeyFailed = true;
    } else if (!registerOne(appHotkey, runSaveCurrentWorkspaceTrigger)) {
      appHotkeyFailed = true;
    }
  }

  lastFailedWorkspaceIds = failed;
  lastAppHotkeyFailed = appHotkeyFailed;
  return { failed, appHotkeyFailed };
}

/** Read by the Settings UI's "needs to be re-picked" indicator. */
export function getFailedHotkeyBindings(): string[] {
  return lastFailedWorkspaceIds;
}

/** Read by the Settings UI's own "needs to be re-picked" indicator for
 * the app-level hotkey specifically. */
export function getAppHotkeyFailed(): boolean {
  return lastAppHotkeyFailed;
}
