import { BrowserWindow, globalShortcut, Notification } from 'electron';
import { isWellFormedAccelerator, switchAccelerator } from '@workspace-launcher/shared';
import { getAllHotkeyBindings } from './workspace-hotkeys-store';
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
 * Re-registers every stored binding's base accelerator (fires Restore)
 * and its derived Shift variant (fires Switch) as live global
 * shortcuts. Never leaves a workspace with only one of the pair
 * registered: if either fails, both are unregistered for that
 * workspace and its id is reported in `failed`, so a workspace never
 * silently ends up with a half-working hotkey.
 */
export function syncHotkeys(): { failed: string[] } {
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

  lastFailedWorkspaceIds = failed;
  return { failed };
}

/** Read by the Settings UI's "needs to be re-picked" indicator. */
export function getFailedHotkeyBindings(): string[] {
  return lastFailedWorkspaceIds;
}
