import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  AccessibilityStatus,
  ChromeListProfilesResult,
  CloseResult,
  CreateWorkspaceResult,
  DeleteWorkspaceResult,
  DetectAppResult,
  DetectProjectFilesResult,
  DetectWorkspaceDraftResult,
  GetLaunchOnLoginResult,
  OpenAccessibilitySettingsResult,
  RestoreProgressEvent,
  SetHotkeyBindingResult,
  SetLaunchOnLoginResult,
  SpotifyListPlaylistsResult,
  StepResult,
  SwitchResult,
  UpdateWorkspaceResult,
  WorkspaceConfig,
} from '@workspace-launcher/shared';
import {
  assignStepIds,
  CURRENT_WORKSPACE_CONFIG_VERSION,
  ERROR_CODES,
  isToolAppKey,
  isWellFormedAccelerator,
  switchAccelerator,
  parseWorkspaceConfig,
  RESTORE_PROGRESS_CHANNEL,
} from '@workspace-launcher/shared';
import { startRestoreFocusSession } from './restore-focus';
import { expandHome } from '../lib/paths';
import {
  closeWorkspace,
  getActiveWorkspaceIds,
  closeRemovedSteps,
  markWorkspaceDetectedActive,
  previewWorkspaceStepRemoval,
  releaseDeletedWorkspace,
  retryStep,
  runWorkspace,
  switchToWorkspace,
} from '../orchestrator/orchestrator';
import { withOrchestratorBusy } from '../orchestrator/orchestrator-busy';
import {
  getAppHotkeyFailed,
  syncHotkeys,
  getFailedHotkeyBindings,
} from '../orchestrator/hotkey-service';
import {
  clearHotkeyBinding,
  getAllHotkeyBindings,
  getHotkeyBinding,
  setHotkeyBinding,
} from '../orchestrator/workspace-hotkeys-store';
import {
  clearSaveCurrentWorkspaceHotkey,
  getSaveCurrentWorkspaceHotkey,
  setSaveCurrentWorkspaceHotkey,
} from '../orchestrator/app-hotkeys-store';
import { detectCurrentWorkspaceDraft } from '../orchestrator/workspace-detection';
import { settingsStore } from '../settings/store';
import { validateStepsWithRegisteredTools } from '../tools/validate-steps';
import {
  deleteWorkspaceConfig,
  loadAllWorkspaceConfigs,
  saveWorkspaceConfig,
} from '../config/loader';
import { toWorkspaceDisplay } from '../config/workspace-display';
import * as spotifyAuth from '../spotify/auth';
import { SpotifyReauthRequiredError } from '../spotify/auth';
import { listPlaylists as listSpotifyPlaylists } from '../spotify/playlists';
import { listChromeProfiles } from '../platform/chrome-profiles';
import { getAppIconDataUrl } from '../platform/app-icon';
import { rescanAndCache } from '../platform/app-detection-cache';
import { checkAccessibilityTrust } from '../platform/macos/accessibility-permission';
import { getWlHelperPath } from '../platform/macos/wl-helper-path';
import type { WorkspaceDisplay } from '../../preload';

// Real app-install detection shells out to macOS-only tools (plutil,
// /Applications enumeration) — see platform/app-detection.ts. Guarded
// here, not inside that module, matching this codebase's existing
// SUPPORTS_WORKSPACE_ACTIVITY convention (same file, workspace activity
// tracking): a feature-level platform check at the IPC boundary, so a
// future Windows build never attempts a macOS-only scan at all rather
// than attempting it and failing. On Windows this resolves to an
// always-empty candidate list, which the renderer already treats as
// "couldn't find it automatically" — the same native-picker fallback
// the generic 'app' step type already relies on, not a new code path.
const SUPPORTS_APP_DETECTION = process.platform === 'darwin';

/**
 * Resolves a workspace id to a real, persisted, runnable WorkspaceConfig.
 * Shared by restoreWorkspace and retryWorkspaceStep below — both need
 * the exact same workspace before they can run any step of it.
 */
async function resolveWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const { configs } = await loadAllWorkspaceConfigs();
  const config = configs.find((c) => c.id === workspaceId);
  if (!config) {
    throw new Error(`No workspace found with id "${workspaceId}".`);
  }
  return config;
}

/**
 * Every runnable WorkspaceConfig on disk. Needed by
 * switchWorkspace/closeWorkspaceStep below, which (unlike
 * restoreWorkspace) have to reason about every OTHER workspace's
 * current activity, not just the one being acted on.
 */
async function resolveAllWorkspaceConfigs(): Promise<WorkspaceConfig[]> {
  return (await loadAllWorkspaceConfigs()).configs;
}

// Workspace activity tracking (Restore/Switch/Close — see
// WCs/WC__workspace-activity.md) is macOS-only v1: there's no
// Windows equivalent of the name-based AppleScript liveness/close
// primitives. On any other platform, `active` is always false and the
// new handlers below return a harmless no-op rather than attempting
// an osascript call that could never work.
const SUPPORTS_WORKSPACE_ACTIVITY = process.platform === 'darwin';

/**
 * Looks up a workspace by id and runs it through the orchestrator.
 * Kept separate from the ipcMain.handle registration below so it's
 * testable without mocking Electron's ipcMain. `onProgress` is optional
 * and Electron-free at this layer too (it's just threaded through to
 * runWorkspace) — the actual IPC push and window-focus wiring live in
 * registerIpcHandlers below, where a real Electron `event`/BrowserWindow
 * is available.
 */
export async function restoreWorkspace(
  workspaceId: unknown,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<StepResult[]> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:restore expects a workspace id (string).');
  }

  // Held for the whole run, not just a check at the start — "Save my
  // current workspace" detection (workspace-detection.ts) needs this to
  // be true for as long as a restore is actually in progress, not just
  // at the instant it began (see orchestrator-busy.ts's own doc comment).
  return withOrchestratorBusy(async () => {
    const allConfigs = await resolveAllWorkspaceConfigs();
    const config = allConfigs.find((c) => c.id === workspaceId);
    if (!config) {
      throw new Error(`No workspace found with id "${workspaceId}".`);
    }
    return runWorkspace(config, {
      allConfigs,
      ...(onProgress ? { onStepProgress: onProgress } : {}),
    });
  });
}

/**
 * The full restore experience — always-on-top focus pinning plus a
 * live per-step progress push, exactly as the `workspaces:restore` IPC
 * handler below gives a renderer-initiated restore — but reusable by
 * anything that has a `BrowserWindow | null` rather than a live IPC
 * `event` to derive one from. The hotkey service (hotkey-service.ts)
 * is the other caller: a hotkey fired while a window happens to be
 * open should get the same experience as clicking the button, not a
 * silently degraded one; a hotkey fired with no window open just skips
 * the pin/push (nothing to pin, nothing to push to).
 */
export async function restoreWorkspaceWithFocus(
  workspaceId: unknown,
  win: BrowserWindow | null,
): Promise<StepResult[]> {
  const session = startRestoreFocusSession(win);
  try {
    return await restoreWorkspace(workspaceId, (progress) => {
      // A destroyed webContents (the window closed mid-restore) makes
      // .send() throw synchronously — that must never propagate into
      // the orchestrator's step loop and abort a restore that's still
      // correctly collecting results for steps that already succeeded.
      try {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(RESTORE_PROGRESS_CHANNEL, progress);
        }
      } catch (err) {
        console.error(
          `Failed to send restore progress: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
}

/**
 * Best-effort display name lookup — used only by the hotkey service's
 * failure notification (a rare path; one extra config load there is
 * cheap and not worth threading names through the hot registration
 * path). Falls back to the raw id rather than throwing: a notification
 * explaining a failure must never itself fail to show over a second,
 * cosmetic lookup problem.
 */
export async function getWorkspaceName(workspaceId: string): Promise<string> {
  try {
    const config = await resolveWorkspaceConfig(workspaceId);
    return config.name;
  } catch {
    return workspaceId;
  }
}

/**
 * Re-resolves the workspace by id and retries exactly one of its steps
 * — the handler behind the Detail view's per-failed-step Retry button.
 * Deliberately has no onProgress/focus-session wiring at all (unlike
 * restoreWorkspace) — retry only ever fires after a restore has already
 * finished (this app's settled UX for it), so there's no multi-step run
 * in progress to keep the user oriented through. workspaceId/stepIndex
 * come straight from the renderer over IPC, so both are validated here
 * rather than trusted — the index gates a real array index into
 * `config.steps`, not just advisory input.
 */
export async function retryWorkspaceStep(
  workspaceId: unknown,
  stepIndex: unknown,
): Promise<StepResult> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:retryStep expects a workspace id (string).');
  }
  if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new Error('workspaces:retryStep expects a non-negative integer step index.');
  }

  // Busy like every other entry point that opens or closes something —
  // a retried step can close and reopen a resource, which "Save my
  // current workspace" detection must never scan mid-way through.
  return withOrchestratorBusy(async () => {
    const allConfigs = await resolveAllWorkspaceConfigs();
    const config = allConfigs.find((c) => c.id === workspaceId);
    if (!config) {
      throw new Error(`No workspace found with id "${workspaceId}".`);
    }
    return retryStep(config, stepIndex, allConfigs);
  });
}

/**
 * The apps removing this step would close — the Detail view's
 * remove-step confirmation (see orchestrator.ts's
 * previewWorkspaceStepRemoval). Both ids come from the renderer, so
 * both are validated; an unknown step simply closes nothing.
 */
export async function previewStepRemoval(workspaceId: unknown, stepId: unknown): Promise<string[]> {
  if (typeof workspaceId !== 'string' || typeof stepId !== 'string') {
    throw new Error(
      'workspaces:previewStepRemoval expects a workspace id and a step id (strings).',
    );
  }
  if (!SUPPORTS_WORKSPACE_ACTIVITY) return [];
  const allConfigs = await resolveAllWorkspaceConfigs();
  const config = allConfigs.find((c) => c.id === workspaceId);
  if (!config) {
    throw new Error(`No workspace found with id "${workspaceId}".`);
  }
  return previewWorkspaceStepRemoval(config, stepId, allConfigs);
}

/**
 * Releases (and, with `close`, closes) what steps just removed from a
 * workspace left behind — called by the Detail view right after a
 * remove-step save; `close` is true only when the user confirmed.
 */
export async function closeRemovedWorkspaceSteps(
  workspaceId: unknown,
  close: unknown,
): Promise<CloseResult> {
  if (typeof workspaceId !== 'string' || typeof close !== 'boolean') {
    throw new Error(
      'workspaces:closeRemovedSteps expects a workspace id (string) and close (boolean).',
    );
  }
  return withOrchestratorBusy(async () => {
    if (!SUPPORTS_WORKSPACE_ACTIVITY) return { closed: [], leftOpen: [] };
    const allConfigs = await resolveAllWorkspaceConfigs();
    const config = allConfigs.find((c) => c.id === workspaceId);
    if (!config) {
      throw new Error(`No workspace found with id "${workspaceId}".`);
    }
    return closeRemovedSteps(config, allConfigs, close);
  });
}

/**
 * Full context change: closes whatever's running that this workspace
 * doesn't need (skipping Chrome and anything another active workspace
 * still needs), then restores this one — see orchestrator.ts's
 * switchToWorkspace for the actual close/open logic. A no-op on any
 * platform but macOS (SUPPORTS_WORKSPACE_ACTIVITY), since there's
 * nothing reliable to close there yet — falls back to a plain restore
 * so the button still does *something* useful if it's ever reached.
 */
export async function switchWorkspace(workspaceId: unknown): Promise<SwitchResult> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:switchTo expects a workspace id (string).');
  }
  return withOrchestratorBusy(async () => {
    const target = await resolveWorkspaceConfig(workspaceId);
    if (!SUPPORTS_WORKSPACE_ACTIVITY) {
      return { stepResults: await runWorkspace(target), closed: [], leftOpen: [] };
    }
    const allConfigs = await resolveAllWorkspaceConfigs();
    return switchToWorkspace(target, allConfigs);
  });
}

/**
 * Closes only this workspace's own apps — see orchestrator.ts's
 * closeWorkspace. A no-op on any platform but macOS: nothing to close.
 */
export async function closeWorkspaceStep(workspaceId: unknown): Promise<CloseResult> {
  if (typeof workspaceId !== 'string') {
    throw new Error('workspaces:close expects a workspace id (string).');
  }
  return withOrchestratorBusy(async () => {
    if (!SUPPORTS_WORKSPACE_ACTIVITY) {
      return { closed: [], leftOpen: [] };
    }
    const target = await resolveWorkspaceConfig(workspaceId);
    const allConfigs = await resolveAllWorkspaceConfigs();
    return closeWorkspace(target, allConfigs);
  });
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
    steps: assignStepIds(steps),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error, code: ERROR_CODES.WORKSPACE_INVALID.code };
  }

  const validationFailure = validateStepsWithRegisteredTools(parsed.config.steps);
  if (validationFailure) {
    return {
      success: false,
      error: validationFailure.error,
      code: ERROR_CODES.WORKSPACE_INVALID.code,
      stepIndex: validationFailure.stepIndex,
      ...(validationFailure.fieldErrors ? { fieldErrors: validationFailure.fieldErrors } : {}),
    };
  }

  await saveWorkspaceConfig(parsed.config);
  return { success: true, config: parsed.config };
}

/**
 * Validates and overwrites an existing real workspace in place (its id
 * never changes). Rejects an unknown id with a specific, honest message
 * before touching validation/disk at all. Reuses saveWorkspaceConfig
 * as-is — it already overwrites `<id>.json` unconditionally.
 */
export async function updateWorkspace(input: unknown): Promise<UpdateWorkspaceResult> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('workspaces:update expects a { id, name, steps } object.');
  }
  const { id, name, steps } = input as { id?: unknown; name?: unknown; steps?: unknown };
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('workspaces:update expects a non-empty string "id".');
  }

  const { configs } = await loadAllWorkspaceConfigs();
  if (!configs.some((config) => config.id === id)) {
    return {
      success: false,
      error: `No workspace found with id "${id}".`,
      code: ERROR_CODES.WORKSPACE_NOT_FOUND.code,
    };
  }

  const parsed = parseWorkspaceConfig({
    version: CURRENT_WORKSPACE_CONFIG_VERSION,
    id,
    name,
    steps: assignStepIds(steps),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error, code: ERROR_CODES.WORKSPACE_INVALID.code };
  }

  const validationFailure = validateStepsWithRegisteredTools(parsed.config.steps);
  if (validationFailure) {
    return {
      success: false,
      error: validationFailure.error,
      code: ERROR_CODES.WORKSPACE_INVALID.code,
      stepIndex: validationFailure.stepIndex,
      ...(validationFailure.fieldErrors ? { fieldErrors: validationFailure.fieldErrors } : {}),
    };
  }

  await saveWorkspaceConfig(parsed.config);
  return { success: true, config: parsed.config };
}

/**
 * Rejects an unknown id with a specific, honest message. Existence is
 * checked here (not just left to deleteWorkspaceConfig's own
 * ENOENT-tolerance) specifically so a *second* delete of the same id
 * reports "No workspace found" rather than silently succeeding again —
 * deleteWorkspaceConfig's own idempotency is what makes it a safe,
 * reusable loader primitive, not what should shape this handler's
 * user-facing behavior.
 */
export async function deleteWorkspace(workspaceId: unknown): Promise<DeleteWorkspaceResult> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('workspaces:delete expects a non-empty workspace id (string).');
  }

  const { configs } = await loadAllWorkspaceConfigs();
  if (!configs.some((config) => config.id === workspaceId)) {
    return {
      success: false,
      error: `No workspace found with id "${workspaceId}".`,
      code: ERROR_CODES.WORKSPACE_NOT_FOUND.code,
    };
  }

  await deleteWorkspaceConfig(workspaceId);
  // Its claims go with it, so it can never keep a shared resource open
  // — but deleting a workspace never closes anything itself.
  releaseDeletedWorkspace(workspaceId);
  // A hotkey bound to a now-gone workspace would otherwise sit
  // orphaned in the store forever — syncHotkeys() would just try to
  // register a hotkey whose callback resolves to a workspace that no
  // longer exists, failing confusingly instead of simply not existing.
  clearHotkeyBinding(workspaceId);
  syncHotkeys();
  return { success: true };
}

/**
 * Persists a new base accelerator for a workspace's global hotkey and
 * (re-)registers it live — see hotkey-service.ts's syncHotkeys for how
 * the actual OS-level registration works, and
 * @workspace-launcher/shared's switchAccelerator for the derived Shift
 * variant. Re-validates the combo's shape independently of the
 * renderer's own recorder constraints (defense in depth — see
 * accelerator.ts's doc comment), and rolls back to the previous
 * binding (or no binding) if the new one fails to register, so a
 * rejected combo never lingers half-applied.
 */
export async function setWorkspaceHotkey(
  workspaceId: unknown,
  accelerator: unknown,
): Promise<SetHotkeyBindingResult> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('hotkeys:setBinding expects a non-empty workspace id (string).');
  }
  if (
    typeof accelerator !== 'string' ||
    !isWellFormedAccelerator(accelerator, { allowShift: false })
  ) {
    return {
      success: false,
      error: 'Not a valid shortcut.',
      code: ERROR_CODES.HOTKEY_INVALID.code,
    };
  }

  const { configs } = await loadAllWorkspaceConfigs();
  if (!configs.some((config) => config.id === workspaceId)) {
    return {
      success: false,
      error: `No workspace found with id "${workspaceId}".`,
      code: ERROR_CODES.WORKSPACE_NOT_FOUND.code,
    };
  }

  // Checked explicitly, BEFORE persisting anything, rather than just
  // letting syncHotkeys()'s normal OS-registration-failure path catch
  // it: syncHotkeys() re-registers every binding fresh from a plain
  // object (insertion-ordered by whichever workspace bound a hotkey
  // FIRST, not by this request), so if this combo already belongs to
  // another workspace, which of the two ends up in its `failed` list
  // depends on that unrelated ordering — it could just as easily be
  // the OTHER, previously-working workspace that silently loses its
  // hotkey while this request reports success. Catching it here, by
  // name, means the request that's actually new/wrong is the one that
  // gets rejected, and with a far clearer message than "already in
  // use" (which one? by what, this app or another?).
  const collision = Object.entries(getAllHotkeyBindings()).find(
    ([id, existing]) => id !== workspaceId && existing === accelerator,
  );
  if (collision) {
    const conflictName = await getWorkspaceName(collision[0]);
    return {
      success: false,
      error: `Already bound to "${conflictName}".`,
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    };
  }
  // Symmetric to setAppHotkey's own identical check below — Electron's
  // globalShortcut.register() never reports a same-process double-
  // registration as a failure (it silently reassigns the callback to
  // whichever registration ran last), so syncHotkeys()'s own OS-level
  // failure detection can't catch a workspace binding colliding with
  // the app-level "Save current workspace" hotkey — this has to be
  // checked explicitly, before persisting, same as the check above.
  //
  // Checked against the app hotkey's value directly AND against
  // switchAccelerator(accelerator) — THIS workspace's own derived
  // Switch combo, which syncHotkeys() also registers but which never
  // appears anywhere getAllHotkeyBindings() exposes, so it could
  // otherwise silently steal an already-working app hotkey with no
  // error surfaced anywhere (a real gap, caught in review).
  const appHotkey = getSaveCurrentWorkspaceHotkey();
  if (appHotkey === accelerator || appHotkey === switchAccelerator(accelerator)) {
    return {
      success: false,
      error: 'Already bound to "Save current workspace".',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    };
  }

  const previous = getHotkeyBinding(workspaceId);
  setHotkeyBinding(workspaceId, accelerator);
  const { failed } = syncHotkeys();

  if (failed.includes(workspaceId)) {
    if (previous) {
      setHotkeyBinding(workspaceId, previous);
    } else {
      clearHotkeyBinding(workspaceId);
    }
    syncHotkeys(); // restore the previous, known-good registration state
    return {
      success: false,
      error: 'That shortcut (or its Shift variant, used for Switch) is already in use.',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    };
  }

  return { success: true };
}

/** Removes a workspace's global hotkey binding entirely and re-syncs. */
export function clearWorkspaceHotkey(workspaceId: unknown): void {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('hotkeys:clearBinding expects a non-empty workspace id (string).');
  }
  clearHotkeyBinding(workspaceId);
  syncHotkeys();
}

export function getWorkspaceHotkey(workspaceId: unknown): string | undefined {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('hotkeys:getBinding expects a non-empty workspace id (string).');
  }
  return getHotkeyBinding(workspaceId);
}

export function getAllWorkspaceHotkeys(): Record<string, string> {
  return getAllHotkeyBindings();
}

/** Workspace ids whose binding failed to register on the most recent
 * sync — the Settings UI's "needs to be re-picked" indicator. */
export function getFailedWorkspaceHotkeys(): string[] {
  return getFailedHotkeyBindings();
}

/**
 * Persists and (re-)registers the single app-level "Save current
 * workspace" accelerator — mirrors setWorkspaceHotkey's shape/
 * rollback-on-failure behavior exactly, minus the per-workspace id
 * (there's only ever one of these) and with Shift allowed in the combo
 * itself (no derived variant reserves it here — see
 * WCs/WC__save-current-workspace.md).
 */
export async function setAppHotkey(accelerator: unknown): Promise<SetHotkeyBindingResult> {
  if (
    typeof accelerator !== 'string' ||
    !isWellFormedAccelerator(accelerator, { allowShift: true })
  ) {
    return {
      success: false,
      error: 'Not a valid shortcut.',
      code: ERROR_CODES.HOTKEY_INVALID.code,
    };
  }

  // Symmetric to setWorkspaceHotkey's own identical check above —
  // checked against each workspace's stored BASE value AND its derived
  // Switch combo (switchAccelerator(existing)), which syncHotkeys()
  // also registers live but which getAllHotkeyBindings() never exposes
  // directly — without this, a new app hotkey could silently steal an
  // already-working workspace's Switch trigger (a real gap, caught in
  // review).
  const collision = Object.entries(getAllHotkeyBindings()).find(
    ([, existing]) => existing === accelerator || switchAccelerator(existing) === accelerator,
  );
  if (collision) {
    const conflictName = await getWorkspaceName(collision[0]);
    return {
      success: false,
      error: `Already bound to "${conflictName}".`,
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    };
  }

  const previous = getSaveCurrentWorkspaceHotkey();
  setSaveCurrentWorkspaceHotkey(accelerator);
  const { appHotkeyFailed } = syncHotkeys();

  if (appHotkeyFailed) {
    if (previous) {
      setSaveCurrentWorkspaceHotkey(previous);
    } else {
      clearSaveCurrentWorkspaceHotkey();
    }
    syncHotkeys(); // restore the previous, known-good registration state
    return {
      success: false,
      error: 'That shortcut is already in use.',
      code: ERROR_CODES.HOTKEY_ALREADY_IN_USE.code,
    };
  }

  return { success: true };
}

/** Removes the app-level hotkey entirely and re-syncs. */
export function clearAppHotkey(): void {
  clearSaveCurrentWorkspaceHotkey();
  syncHotkeys();
}

export function getAppHotkey(): string | undefined {
  return getSaveCurrentWorkspaceHotkey();
}

/** Whether the app-level hotkey failed to register on the most recent
 * sync — the Settings UI's own "needs to be re-picked" indicator. */
export function getAppHotkeyFailedBinding(): boolean {
  return getAppHotkeyFailed();
}

/**
 * Runs a "Save my current workspace" detection pass — see
 * orchestrator/workspace-detection.ts. Nothing is saved here; this only
 * returns a draft for the renderer's review screen to show, edit, and
 * eventually hand to the existing createWorkspace flow unchanged.
 */
export async function detectCurrentWorkspace(): Promise<DetectWorkspaceDraftResult> {
  return detectCurrentWorkspaceDraft();
}

/**
 * Marks a freshly-saved, detected-from-live-state workspace as
 * currently active (see WCs/WC__workspace-activity.md's intent+liveness
 * model) — everything in it was, by construction, already running at
 * detection time. Deliberately NOT folded into createWorkspace itself:
 * that function is also the ordinary manual "New workspace" save path,
 * where a hand-built, never-run config is correctly NOT active. Setting
 * intent here is safe even if some detected process has already exited
 * by the time the save completes — the displayed "Active" state always
 * ANDs intent with real liveness, never trusts intent alone. Tracked
 * steps' running apps are recorded as the workspace's resources, but
 * as not opened by this app, so Close never quits them (see
 * orchestrator.ts's markWorkspaceDetectedActive).
 */
export async function markWorkspaceActive(workspaceId: unknown): Promise<void> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('workspaces:markActive expects a non-empty workspace id (string).');
  }
  await markWorkspaceDetectedActive(await resolveWorkspaceConfig(workspaceId));
}

/**
 * Always a live read of the OS's own login-item state, synced back
 * into settingsStore — never trusts the stored value alone, since the
 * user could change this from macOS System Settings > Login Items
 * directly, outside this app entirely.
 */
export function getLaunchOnLogin(): GetLaunchOnLoginResult {
  const enabled = app.getLoginItemSettings().openAtLogin;
  settingsStore.set('launchOnLogin', enabled);
  return { success: true, enabled };
}

/** Follows the same `{success, error, code}` shape as every other
 * fallible-OS-call handler in this file (spotify:listPlaylists,
 * chrome:listProfiles, app:detectInstalls) rather than a bare throw —
 * `setLoginItemSettings` can genuinely fail, e.g. on an unsigned or
 * mis-entitled build.
 *
 * Refuses outright on an unpackaged dev build: `setLoginItemSettings`
 * would register whatever's actually on disk at this process's
 * executable path — in dev that's the generic, shared
 * `node_modules/electron/dist/Electron.app` binary every electron-vite
 * project uses, not a real "Workspace Launcher.app". Confirmed live:
 * macOS's own "Login Item Added" system notification named it
 * "Electron.app," not this app — exactly the confusing, wrong-named
 * registration this guard exists to prevent. A packaged
 * (electron-builder) build has its own real bundle and doesn't hit
 * this at all. */
export function setLaunchOnLogin(value: unknown): SetLaunchOnLoginResult {
  if (typeof value !== 'boolean') {
    throw new Error('settings:setLaunchOnLogin expects a boolean.');
  }
  // Turning it OFF is always allowed, even unpackaged — someone needs
  // a way to undo a login item a dev build already registered (e.g.
  // from before this guard existed) without leaving System Settings as
  // the only way out. Only turning it ON is blocked in dev.
  if (value && !app.isPackaged) {
    return {
      success: false,
      error:
        "Not available in a dev build — it would register the generic 'Electron.app' instead of Workspace Launcher. Try this once the app is installed.",
      code: ERROR_CODES.LAUNCH_ON_LOGIN_FAILED.code,
    };
  }
  try {
    app.setLoginItemSettings({ openAtLogin: value });
    settingsStore.set('launchOnLogin', value);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      code: ERROR_CODES.LAUNCH_ON_LOGIN_FAILED.code,
    };
  }
}

/**
 * Every real, persisted workspace. A per-file load error (malformed
 * JSON, failed schema, duplicate id) is logged, not thrown or surfaced
 * as a total failure — loadAllWorkspaceConfigs already returns
 * everything that *did* load successfully, and one bad file shouldn't
 * blank the whole sidebar.
 */
export async function listWorkspaces(): Promise<WorkspaceDisplay[]> {
  const { configs, errors } = await loadAllWorkspaceConfigs();
  for (const [file, message] of Object.entries(errors)) {
    console.error(`Failed to load workspace config "${file}": ${message}`);
  }

  // Workspace activity (Restore/Switch/Close — see
  // WCs/WC__workspace-activity.md) is macOS-only v1 — skip every
  // osascript call on any other platform rather than attempt one that
  // could never work.
  const activeIds = SUPPORTS_WORKSPACE_ACTIVITY
    ? await getActiveWorkspaceIds(configs)
    : new Set<string>();

  return configs.map((config) => ({
    ...toWorkspaceDisplay(config),
    active: activeIds.has(config.id),
  }));
}

// Compose's own real discovery priority with no explicit `-f` given —
// confirmed empirically against a real local Compose install this same
// session (2026-10-24 orchestration-testbed work, WCs/WC__project-
// status.md): with several present, it only warns and picks the first
// in this order. Mirroring it here isn't a guess, it's exactly what
// `docker compose` would pick anyway.
const COMPOSE_FILE_CANDIDATES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
];

// Only a genuine "not there" (ENOENT) resolves to false — anything else
// (EACCES, a parent path segment being a file, etc.) is a real failure
// and must propagate to detectProjectFiles' own try/catch below, not get
// silently swallowed into a false "not found" the UI can't tell apart
// from an actual clean scan.
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Given a project directory, reports which Compose file `docker
 * compose` would pick with no `-f` given (if any) and whether a
 * Tiltfile exists — both checked in parallel, per-candidate, never
 * reading file contents. The one real cross-engine ambiguity (both
 * present) is deliberately left unresolved here — see
 * ProjectFilesDetection's own doc comment for why.
 */
export async function detectProjectFiles(directory: string): Promise<DetectProjectFilesResult> {
  try {
    const dir = expandHome(directory);
    const [composeHits, hasTiltfile] = await Promise.all([
      Promise.all(COMPOSE_FILE_CANDIDATES.map((name) => fileExists(join(dir, name)))),
      fileExists(join(dir, 'Tiltfile')),
    ]);
    const composeFileIndex = composeHits.findIndex(Boolean);
    const composeFile =
      composeFileIndex === -1 ? undefined : COMPOSE_FILE_CANDIDATES[composeFileIndex];
    return { success: true, ...(composeFile ? { composeFile } : {}), hasTiltfile };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      code: ERROR_CODES.PROJECT_FILES_DETECTION_FAILED.code,
    };
  }
}

/**
 * Registers every 'channel' the preload bridge is allowed to invoke.
 * This is the single place that decides what the renderer can ask the
 * main process to do — keep it a short, explicit list.
 */
// Per-window tracking needs macOS Accessibility (see
// WCs/WC__window-tracking.md) — same feature-level platform gate as
// SUPPORTS_WORKSPACE_ACTIVITY above: elsewhere the status is
// 'unsupported' and the renderer shows nothing.
const SUPPORTS_ACCESSIBILITY = process.platform === 'darwin';

// Opens System Settings straight at Privacy & Security → Accessibility.
// The documented deep link for every macOS this app supports (11+);
// the newer System Settings app still honors it.
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

/**
 * A fresh trust check on every call (see accessibility-permission.ts
 * for why never a cached answer) — the onboarding modal polls this
 * once a second while it's open. Seeing the grant also completes
 * onboarding, so a user who granted access straight from System
 * Settings is never shown the first-launch explanation afterwards.
 */
export async function getAccessibilityStatus(): Promise<AccessibilityStatus> {
  if (!SUPPORTS_ACCESSIBILITY) {
    return { state: 'unsupported' };
  }
  const check = await checkAccessibilityTrust(getWlHelperPath());
  if (!check.ok) {
    console.error(`Accessibility check failed: ${check.error}`);
    return {
      state: 'helper-unavailable',
      error: check.error,
      code: ERROR_CODES.WINDOW_HELPER_UNAVAILABLE.code,
    };
  }
  if (check.trusted) {
    settingsStore.set('hasCompletedAccessibilityOnboarding', true);
    return { state: 'granted' };
  }
  return {
    state: 'not-granted',
    onboardingCompleted: settingsStore.get('hasCompletedAccessibilityOnboarding'),
    code: ERROR_CODES.ACCESSIBILITY_NOT_GRANTED.code,
  };
}

export async function openAccessibilitySettings(): Promise<OpenAccessibilitySettingsResult> {
  if (!SUPPORTS_ACCESSIBILITY) {
    return {
      success: false,
      error: 'Accessibility settings only exist on macOS.',
      code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
    };
  }
  try {
    await shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Couldn't open System Settings: ${err instanceof Error ? err.message : String(err)}`,
      code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
    };
  }
}

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
    return restoreWorkspaceWithFocus(workspaceId, win);
  });

  ipcMain.handle(
    'workspaces:retryStep',
    async (_event, workspaceId: unknown, stepIndex: unknown) => {
      return retryWorkspaceStep(workspaceId, stepIndex);
    },
  );

  ipcMain.handle('workspaces:create', async (_event, input: unknown) => {
    return createWorkspace(input);
  });

  ipcMain.handle('workspaces:update', async (_event, input: unknown) => {
    return updateWorkspace(input);
  });

  ipcMain.handle('workspaces:delete', async (_event, workspaceId: unknown) => {
    return deleteWorkspace(workspaceId);
  });

  ipcMain.handle('workspaces:switchTo', async (_event, workspaceId: unknown) => {
    return switchWorkspace(workspaceId);
  });

  ipcMain.handle(
    'workspaces:previewStepRemoval',
    async (_event, workspaceId: unknown, stepId: unknown) => {
      return previewStepRemoval(workspaceId, stepId);
    },
  );
  ipcMain.handle(
    'workspaces:closeRemovedSteps',
    async (_event, workspaceId: unknown, close: unknown) => {
      return closeRemovedWorkspaceSteps(workspaceId, close);
    },
  );
  ipcMain.handle('workspaces:close', async (_event, workspaceId: unknown) => {
    return closeWorkspaceStep(workspaceId);
  });

  ipcMain.handle('dialog:selectProjectFolder', async (event): Promise<string | null> => {
    // BrowserWindow.fromWebContents can return null (same case
    // restore-focus.ts's startRestoreFocusSession already guards) —
    // dialog.showOpenDialog has no overload accepting `BrowserWindow |
    // null`, only a real window or no window argument at all.
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('dialog:selectApp', async (event): Promise<string | null> => {
    // `openFile`, not `openDirectory` — a `.app` bundle is technically a
    // directory, but macOS's own NSOpenPanel (what this dialog is under
    // the hood) already presents `.app` bundles as selectable, non-
    // navigable items in openFile mode, same as Finder does. The
    // `extensions: ['app']` filter narrows the dialog to just those.
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
      defaultPath: '/Applications',
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('dialog:selectFile', async (event): Promise<string | null> => {
    // No filter/defaultPath restriction, unlike selectApp above — the
    // "File or Link" step's whole point is opening an arbitrary
    // document (any extension, anywhere on disk), not a constrained
    // category like an Applications-folder .app bundle.
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('spotify:connect', async () => {
    return spotifyAuth.connect();
  });

  ipcMain.handle('spotify:status', async () => {
    return spotifyAuth.getConnectionStatus();
  });

  ipcMain.handle('spotify:disconnect', async () => {
    spotifyAuth.disconnect();
  });

  ipcMain.handle('spotify:listPlaylists', async (): Promise<SpotifyListPlaylistsResult> => {
    try {
      return { success: true, playlists: await listSpotifyPlaylists() };
    } catch (err) {
      if (err instanceof SpotifyReauthRequiredError) {
        return {
          success: false,
          error: 'reauth-required',
          code: ERROR_CODES.SPOTIFY_REAUTH_REQUIRED.code,
        };
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.SPOTIFY_PLAYLISTS_FAILED.code,
      };
    }
  });

  ipcMain.handle('chrome:listProfiles', async (): Promise<ChromeListProfilesResult> => {
    try {
      return { success: true, profiles: await listChromeProfiles() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.CHROME_PROFILES_UNAVAILABLE.code,
      };
    }
  });

  ipcMain.handle(
    'app:detectInstalls',
    async (_event, toolKey: unknown): Promise<DetectAppResult> => {
      if (!isToolAppKey(toolKey)) {
        throw new Error(
          'app:detectInstalls expects a known tool key (vscode/chrome/spotify/clockify).',
        );
      }
      if (!SUPPORTS_APP_DETECTION) {
        return { success: true, candidates: [] };
      }
      try {
        const all = await rescanAndCache();
        return { success: true, candidates: all[toolKey] };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.APP_DETECTION_FAILED.code,
        };
      }
    },
  );

  ipcMain.handle(
    'fs:detectProjectFiles',
    async (_event, directory: unknown): Promise<DetectProjectFilesResult> => {
      if (typeof directory !== 'string' || directory.length === 0) {
        throw new Error('fs:detectProjectFiles expects a non-empty string directory.');
      }
      return detectProjectFiles(directory);
    },
  );

  ipcMain.handle('app:getIcon', async (_event, appPath: unknown): Promise<string | null> => {
    // A soft, best-effort display enhancement, not user input being
    // validated for a mutation — an invalid/missing path just means
    // "no icon," the same honest outcome as a real path that fails to
    // resolve, never a thrown error the renderer would need to handle.
    if (typeof appPath !== 'string' || appPath.length === 0) {
      return null;
    }
    return getAppIconDataUrl(appPath);
  });

  ipcMain.handle('hotkeys:getBinding', async (_event, workspaceId: unknown) => {
    return getWorkspaceHotkey(workspaceId);
  });

  ipcMain.handle('hotkeys:getAllBindings', async () => {
    return getAllWorkspaceHotkeys();
  });

  ipcMain.handle(
    'hotkeys:setBinding',
    async (_event, workspaceId: unknown, accelerator: unknown) => {
      return setWorkspaceHotkey(workspaceId, accelerator);
    },
  );

  ipcMain.handle('hotkeys:clearBinding', async (_event, workspaceId: unknown) => {
    clearWorkspaceHotkey(workspaceId);
  });

  ipcMain.handle('hotkeys:getFailedBindings', async () => {
    return getFailedWorkspaceHotkeys();
  });

  ipcMain.handle('hotkeys:getAppHotkey', async () => {
    return getAppHotkey();
  });

  ipcMain.handle('hotkeys:setAppHotkey', async (_event, accelerator: unknown) => {
    return setAppHotkey(accelerator);
  });

  ipcMain.handle('hotkeys:clearAppHotkey', async () => {
    clearAppHotkey();
  });

  ipcMain.handle('hotkeys:getAppHotkeyFailed', async () => {
    return getAppHotkeyFailedBinding();
  });

  ipcMain.handle('workspaces:detectCurrent', async () => {
    return detectCurrentWorkspace();
  });

  ipcMain.handle('workspaces:markActive', async (_event, workspaceId: unknown) => {
    await markWorkspaceActive(workspaceId);
  });

  ipcMain.handle('settings:getLaunchOnLogin', async () => {
    return getLaunchOnLogin();
  });

  ipcMain.handle('settings:setLaunchOnLogin', async (_event, value: unknown) => {
    return setLaunchOnLogin(value);
  });

  ipcMain.handle('accessibility:getStatus', async () => {
    return getAccessibilityStatus();
  });

  ipcMain.handle('accessibility:openSettings', async () => {
    return openAccessibilitySettings();
  });

  ipcMain.handle('accessibility:completeOnboarding', async () => {
    settingsStore.set('hasCompletedAccessibilityOnboarding', true);
  });
}
