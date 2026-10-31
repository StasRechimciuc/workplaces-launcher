import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LeftOpenEntry,
  WorkspaceStepInput,
  RestoreProgressEvent,
  StepResult,
  WorkspaceConfig,
} from '@workspace-launcher/shared';
import { ERROR_CODES, isToolAppKey } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { useIsMounted } from '../lib/useIsMounted';
import { getRecentProjectPaths } from '../lib/recent-project-paths';
import { getRecentCommands } from '../lib/recent-commands';
import { workspaceLaunchTimeLabel, workspaceLaunchTimeTooltip } from '../lib/launch-time-display';
import { replaceStepParams } from '../lib/replace-step-params';
import { useSpotifyConnection } from '../lib/useSpotifyConnection';
import { useAppPathDetections } from '../lib/useAppPathDetections';
import { useProjectFilesDetection } from '../lib/useProjectFilesDetection';
import { PROJECT_PATH_STEP_TYPES, getProjectPathSuggestion } from '../lib/project-path-suggestion';
import {
  resultsForSteps,
  withStepsChangeOutcome,
  type WorkspaceRestoreState,
} from '../lib/workspace-restore-state';
import { TimelineStep } from './TimelineStep';
import { RestoreResults } from './RestoreResults';
import { StepChangeConfirm } from './StepChangeConfirm';
import { AddToolMenu } from './AddToolMenu';
import type { CreateToolPreset } from '../constants';
import { ErrorCode } from './ErrorCode';
import { WorkspaceHotkeyControl } from './WorkspaceHotkeyControl';

/** A message paired with its (possibly absent) error code — the shape
 * every locally-owned error-display state in this component uses, so
 * the code travels alongside the message instead of being dropped. */
interface DisplayError {
  message: string;
  code?: string;
}

/** `handleSaveStep`'s own error shape — a DisplayError plus the per-
 * field breakdown of the SAME failed save, kept as a sibling field
 * rather than nested inside `message`/`code`, matching
 * WorkspaceFormModal.tsx's own saveError shape. Not folded into the
 * generic DisplayError above since restoreError/removeStepError never
 * carry field-level detail — adding it there would leak an always-
 * unused field into every other error state in this component. */
interface SaveStepDisplayError extends DisplayError {
  fieldErrors?: Record<string, string>;
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface DetailProps {
  workspace: WorkspaceDisplay;
  /** All saved workspaces, including this one — only used to derive
   * VS Code's inline "Recent" folder suggestions, same source
   * WorkspaceFormModal.tsx already computes this from. */
  allWorkspaces: WorkspaceDisplay[];
  onEditWorkspace: (workspace: WorkspaceDisplay) => void;
  /** "+ Add step" for a tool with fields to fill in: opens the Edit form with it added. */
  onAddStepInForm: (workspace: WorkspaceDisplay, type: string) => void;
  onDeleteWorkspace: (workspace: WorkspaceDisplay) => void;
  /** Fires after a successful inline quick-edit save, mirroring
   * WorkspaceFormModal's onSaved — App.tsx uses it to refresh the
   * workspace list so Detail reflects the just-saved params. */
  onQuickEditSaved: (config: WorkspaceConfig) => void;
  /** Opens ErrorsModal (App.tsx-owned) targeting a specific error code
   * — the "Learn more about this error" link's handler, threaded down
   * into RestoreResults and TimelineStep. */
  onShowErrorCode: (code: string) => void;
  /** Fires after Restore/Switch/Close — unlike onQuickEditSaved, these
   * can change ANOTHER workspace's `active` state too (Switch/Close
   * both can), so App.tsx does a full refreshWorkspaces() with no
   * specific id to re-select. */
  onWorkspaceActivityChanged: () => void;
  /** This workspace's last Restore/Switch/Close outcome — owned by
   * App.tsx (see workspace-restore-state.ts), not local state, so it
   * survives this component remounting on workspace switch. Looked up
   * for this exact workspace already — Detail never indexes into a
   * map itself. */
  restoreState: WorkspaceRestoreState;
  /** Patches this workspace's slice of that lifted state — already
   * bound to this workspace's id by App.tsx, so every call site below
   * just passes a patch, never an id. */
  onUpdateRestoreState: (
    patch:
      | Partial<WorkspaceRestoreState>
      | ((prev: WorkspaceRestoreState) => Partial<WorkspaceRestoreState>),
  ) => void;
}

/** One "left open" row of a Close/Switch result, in plain words per reason. */
function describeLeftOpen(entry: LeftOpenEntry): string {
  const detail = entry.detail ? `: ${entry.detail}` : '.';
  switch (entry.reason) {
    case 'failed':
      return `Couldn't close ${entry.appName}${detail}`;
    // The detail names which permission (Accessibility, or control of a
    // browser — its tabs can't be saved without it).
    case 'needs-permission':
      return entry.detail
        ? `Couldn't close ${entry.appName}: ${entry.detail}`
        : `Couldn't close ${entry.appName} — it needs Accessibility access.`;
    case 'kept-running':
      return `Left ${entry.appName} running${entry.detail ? ` (${entry.detail})` : ''}.`;
    case 'not-ours':
      return `Left ${entry.appName} running (it was already open before this workspace).`;
    case 'excluded':
      return `Left ${entry.appName} running (not auto-closed).`;
    case 'still-used':
      return entry.usedBy && entry.usedBy.length > 0
        ? `Left ${entry.appName} running (still used by ${entry.usedBy.join(', ')}).`
        : `Left ${entry.appName} running (still used by another active workspace).`;
  }
}

/**
 * Render key is the workspace id (see App.tsx) — React remounts this
 * component on workspace switch, which naturally resets expandedIndex
 * (and the quick-edit state below) to their initial values, same as
 * the mockup's manual `expandedIndex = null` reset. Restore state
 * itself (`restoreState` prop) deliberately does NOT reset on this
 * remount — it's owned by App.tsx precisely so it doesn't.
 */
export function Detail({
  workspace,
  allWorkspaces,
  onEditWorkspace,
  onAddStepInForm,
  onDeleteWorkspace,
  onQuickEditSaved,
  onShowErrorCode,
  onWorkspaceActivityChanged,
  restoreState,
  onUpdateRestoreState,
}: DetailProps): JSX.Element {
  const {
    isRestoring,
    isSwitching,
    isClosing,
    restoreResults,
    restoredAt,
    stepIdsAtRestore,
    activityLog,
    retryingIndex,
  } = restoreState;
  // Last restore's results for the steps that still exist, by step id —
  // see resultsForSteps.
  const currentResults = useMemo(
    () => resultsForSteps({ restoreResults, stepIdsAtRestore }, workspace.tools),
    [restoreResults, stepIdsAtRestore, workspace.tools],
  );
  const resultByStepId = useMemo(
    () => new Map(currentResults.map((r) => [r.step.id, r.result])),
    [currentResults],
  );
  // By step id, not position: removing a step above the open one must
  // not hand its draft to whichever step slides into its place.
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const expandedPosition = workspace.tools.findIndex((t) => t.id === expandedStepId);
  const expandedIndex = expandedPosition === -1 ? null : expandedPosition;
  const [restoreError, setRestoreError] = useState<DisplayError | null>(null);
  const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);
  // Per-step live status during an in-flight restore, keyed by index —
  // the SAME event stream `progress` above already reads (orchestrator.ts
  // fires one per step on start, another on finish, with the real
  // success/failure already known), just accumulated instead of
  // overwritten, so each row can show its own live state (a spinner
  // while running, a quick provisional result the instant it resolves)
  // rather than only one generic "Step N of M" line above the whole
  // list. Deliberately NOT replacing `restoreResults` once the full
  // batch lands — TimelineStep still prefers the real `result` (richer:
  // exit codes, command breakdowns) over this provisional one wherever
  // both exist.
  const [liveStepStatus, setLiveStepStatus] = useState<Record<number, RestoreProgressEvent>>({});

  // Inline quick-edit state — only ever relevant for whichever single
  // step is currently expanded (expandedIndex), same one-at-a-time
  // shape that already governs expand/collapse.
  const [draftParams, setDraftParams] = useState<Record<string, unknown> | null>(null);
  const [addStepError, setAddStepError] = useState<{ message: string; code: string } | null>(null);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [saveStepError, setSaveStepError] = useState<SaveStepDisplayError | null>(null);
  // Removing a single step — independent of the quick-edit state above
  // (a step can be removed whether or not it's currently expanded).
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [removeStepError, setRemoveStepError] = useState<DisplayError | null>(null);
  // Set while StepChangeConfirm is open: a remove or a quick-edit save
  // that would close something, waiting for the user's answer.
  const [pendingChange, setPendingChange] = useState<
    | { action: 'remove'; stepId: string; closes: string[] }
    | { action: 'save'; stepId: string; params: Record<string, unknown>; closes: string[] }
    | null
  >(null);
  // The steps as last saved — ahead of `workspace` between a save and
  // the list refresh it triggers, so a change made right after another
  // builds on it instead of bringing back what it removed.
  const savedStepsRef = useRef<
    readonly { id: string; type: string; params: Record<string, unknown> }[]
  >(workspace.tools);
  useEffect(() => {
    savedStepsRef.current = workspace.tools;
  }, [workspace.tools]);
  // One step change (preview → save → apply) at a time: a second ✕ or
  // Save while one is in flight is ignored rather than raced.
  const stepChangeBusyRef = useRef(false);
  const recentFolders = useMemo(() => getRecentProjectPaths(allWorkspaces), [allWorkspaces]);
  const recentCommands = useMemo(() => getRecentCommands(allWorkspaces), [allWorkspaces]);
  // Independently instantiated from WorkspaceFormModal's own instance —
  // it's cheap and self-contained (status is a no-network local read,
  // see useSpotifyConnection.ts's own doc comment), not worth lifting
  // to App.tsx just to share between two consumers.
  const spotify = useSpotifyConnection();
  // Same reasoning as spotify above — independently instantiated from
  // WorkspaceFormModal's own instance. No reset-on-close here (unlike
  // the modal): a detected app path stays valid for the whole session
  // regardless of which workspace's Detail view is showing, so there's
  // nothing to invalidate when switching the selected workspace.
  const appPathDetections = useAppPathDetections();
  // Same lifted-to-survive-collapse reasoning as appPathDetections above
  // — a Docker row's fields block fully unmounts when collapsed, so
  // state owned locally by docker-fields.tsx would re-scan on every
  // re-expand. No reset-on-close here either, same precedent.
  const projectFilesDetection = useProjectFilesDetection();
  const isMac = window.api.platform === 'darwin';

  function handleToggleStep(i: number): void {
    const id = workspace.tools[i]?.id ?? null;
    setExpandedStepId((current) => (current === id ? null : id));
    setDraftParams(null);
    setSaveStepError(null);
  }

  /**
   * Returns whether the save actually succeeded — most callers (the
   * Save button itself) don't need this, but `handleRestore` does: it
   * must know whether to proceed with an auto-committed draft or abort
   * the restore entirely, see its own comment on why.
   */
  /**
   * Quick-edit Save. A change that would close something this workspace
   * opened and nothing else uses (a terminal whose command changed)
   * asks first (StepChangeConfirm); otherwise it saves straight away.
   * Resolves false when nothing was saved yet — a failure, or the
   * confirmation is still open — so a Restore waiting on it stops.
   */
  async function handleSaveStep(i: number): Promise<boolean> {
    if (draftParams === null) return true; // nothing to save is not a failure
    const stepId = workspace.tools[i]?.id;
    if (stepId === undefined || stepChangeBusyRef.current) return false;
    const params = draftParams;
    stepChangeBusyRef.current = true;
    setIsSavingStep(true);
    setSaveStepError(null);
    try {
      const closes = await window.api.previewStepsChange(
        workspace.id,
        stepsWithParams(stepId, params),
      );
      if (closes.length > 0) {
        setPendingChange({ action: 'save', stepId, params, closes });
        return false;
      }
      return await saveStep(stepId, params, false);
    } catch (err) {
      setSaveStepError({
        message: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
      });
      return false;
    } finally {
      stepChangeBusyRef.current = false;
      setIsSavingStep(false);
    }
  }

  /**
   * "+ Add step": an App step is complete the moment an app is chosen,
   * so it's picked and saved right here (two clicks, no form); any other
   * tool has fields to fill in, so the Edit form opens with it added.
   */
  async function handleAddStep(preset: CreateToolPreset): Promise<void> {
    if (preset.type !== 'app') {
      onAddStepInForm(workspace, preset.type);
      return;
    }
    if (stepChangeBusyRef.current) return;
    setAddStepError(null);
    const path = await window.api.selectApp();
    if (path === null || !isMountedRef.current) return;
    stepChangeBusyRef.current = true;
    setIsSavingStep(true);
    try {
      const result = await window.api.updateWorkspace({
        id: workspace.id,
        name: workspace.name,
        steps: [...currentSteps(), { type: 'app', params: { path } }],
      });
      if (!isMountedRef.current) return;
      if (result.success) recordSaved(result.config);
      else setAddStepError({ message: result.error, code: result.code });
    } catch (err) {
      if (isMountedRef.current) {
        setAddStepError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      stepChangeBusyRef.current = false;
      if (isMountedRef.current) setIsSavingStep(false);
    }
  }

  function currentSteps(): WorkspaceStepInput[] {
    return savedStepsRef.current.map((t) => ({ id: t.id, type: t.type, params: t.params }));
  }

  function stepsWithParams(stepId: string, params: Record<string, unknown>): WorkspaceStepInput[] {
    const steps = currentSteps();
    return replaceStepParams(
      steps,
      steps.findIndex((t) => t.id === stepId),
      params,
    );
  }

  /** Saves the step's new params, then applies the saved change. */
  async function saveStep(
    stepId: string,
    params: Record<string, unknown>,
    close: boolean,
  ): Promise<boolean> {
    if (!savedStepsRef.current.some((t) => t.id === stepId)) return false;
    setIsSavingStep(true);
    setSaveStepError(null);
    try {
      const result = await window.api.updateWorkspace({
        id: workspace.id,
        name: workspace.name,
        steps: stepsWithParams(stepId, params),
      });
      if (!result.success) {
        setSaveStepError({
          message: result.error,
          code: result.code,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        });
        return false;
      }
      setDraftParams(null);
      recordSaved(result.config);
    } catch (err) {
      setSaveStepError({
        message: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
      });
      return false;
    } finally {
      setIsSavingStep(false);
    }
    await applySavedChange(close);
    return true;
  }

  /** A save went through: what later changes build on, and the list refresh. */
  function recordSaved(config: WorkspaceConfig): void {
    savedStepsRef.current = config.steps;
    onQuickEditSaved(config);
  }

  /**
   * After a saved edit: what removed/changed steps held is released
   * (closed only with `close` — confirmed), and changed steps run again
   * with their new settings; their fresh results replace their old
   * ones. See orchestrator.ts's applyStepsChange. The edit is already
   * saved, so a failure here is shown as the apply's own, never undoing
   * it. Recorded in App's per-workspace restore state, which stays valid
   * if this view has gone in the meantime.
   */
  async function applySavedChange(close: boolean): Promise<void> {
    try {
      const report = await window.api.applyStepsChange(workspace.id, close);
      onUpdateRestoreState((prev) => withStepsChangeOutcome(prev, { report }));
    } catch (err) {
      const error = `Saved, but couldn't apply the change to what's running: ${err instanceof Error ? err.message : String(err)}`;
      onUpdateRestoreState((prev) => withStepsChangeOutcome(prev, { error }));
    } finally {
      // What closed changes which workspaces are active.
      onWorkspaceActivityChanged();
    }
  }

  function handleCancelStep(): void {
    setDraftParams(null);
    setSaveStepError(null);
  }

  /**
   * Remove-step button: asks first only when removing it would close an
   * app right away — one this workspace opened that nothing else uses
   * (previewStepsChange). Otherwise (shared, already open before, not
   * running) the step is simply removed.
   */
  async function handleRemoveStep(i: number): Promise<void> {
    const tool = workspace.tools[i];
    if (!tool || stepChangeBusyRef.current) return;
    stepChangeBusyRef.current = true;
    setRemovingIndex(i);
    setRemoveStepError(null);
    try {
      const closes = await window.api.previewStepsChange(
        workspace.id,
        currentSteps().filter((t) => t.id !== tool.id),
      );
      if (!isMountedRef.current) return;
      if (closes.length > 0) {
        setPendingChange({ action: 'remove', stepId: tool.id, closes });
        return;
      }
      await removeStep(tool.id, false);
    } catch (err) {
      if (isMountedRef.current) {
        setRemoveStepError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      stepChangeBusyRef.current = false;
      if (isMountedRef.current) setRemovingIndex(null);
    }
  }

  /**
   * Saves the workspace without the step (by id — the list may have
   * changed while a confirmation was open), then releases its claims,
   * closing what it left behind only when the user confirmed `close`.
   */
  async function removeStep(stepId: string, close: boolean): Promise<void> {
    const i = workspace.tools.findIndex((t) => t.id === stepId);
    if (i === -1) return;
    setRemovingIndex(i);
    setRemoveStepError(null);
    try {
      const result = await window.api.updateWorkspace({
        id: workspace.id,
        name: workspace.name,
        steps: currentSteps().filter((t) => t.id !== stepId),
      });
      if (!result.success) {
        if (isMountedRef.current) setRemoveStepError({ message: result.error, code: result.code });
        return;
      }
      if (isMountedRef.current && expandedStepId === stepId) {
        setExpandedStepId(null);
        setDraftParams(null);
        setSaveStepError(null);
      }
      // Refreshes the workspace list too, active badges included.
      recordSaved(result.config);
    } catch (err) {
      if (isMountedRef.current) {
        setRemoveStepError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
      return;
    } finally {
      if (isMountedRef.current) setRemovingIndex(null);
    }
    await applySavedChange(close);
  }

  /** The confirmation's answer: one step change at a time, like its first half. */
  async function confirmPendingChange(change: NonNullable<typeof pendingChange>): Promise<void> {
    if (stepChangeBusyRef.current) return;
    stepChangeBusyRef.current = true;
    try {
      if (change.action === 'remove') await removeStep(change.stepId, true);
      else await saveStep(change.stepId, change.params, true);
    } finally {
      stepChangeBusyRef.current = false;
    }
  }

  // Still needed for restoreError/progress below — those stay real
  // local Detail state (unlike restoreState's 7 fields, which now live
  // in App.tsx and stay valid regardless of whether THIS component
  // instance is still mounted when their async work resolves).
  const isMountedRef = useIsMounted();

  async function handleRestore(): Promise<void> {
    // An open, unsaved quick-edit draft must never be silently ignored
    // by a restore that goes on to use the OLD saved config instead —
    // commit it first. If the save itself fails (invalid input, a
    // write error), the restore is aborted entirely rather than
    // proceeding against config the user explicitly just tried to
    // change — the failure is already visible inline on the open row
    // via `saveStepError`, so there's nothing more to surface here.
    if (expandedIndex !== null && draftParams !== null) {
      const saved = await handleSaveStep(expandedIndex);
      if (!saved) return;
    }

    // A fresh full restore makes any in-flight retry from the previous
    // results moot — without this, a retry that resolves after the new
    // restore starts would otherwise leave retryingIndex stuck non-null
    // forever (its own update becomes a no-op once restoreResults has
    // been reset to null above), wrongly disabling every Retry button
    // on the new results once they arrive.
    onUpdateRestoreState({
      isRestoring: true,
      restoreResults: null,
      restoredAt: null,
      stepIdsAtRestore: null,
      activityLog: null,
      retryingIndex: null,
      applyError: null,
    });
    setRestoreError(null);
    setProgress(null);
    setLiveStepStatus({});
    // Ignoring events for a different workspace id guards against a
    // stale/overlapping restore: switching workspaces mid-restore
    // remounts this component (key={workspace.id} in App.tsx), but the
    // old restore's promise — and this subscription — keeps running in
    // the background until it resolves.
    const unsubscribe = window.api.onRestoreProgress((event) => {
      if (event.workspaceId !== workspace.id || !isMountedRef.current) return;
      setProgress(event);
      setLiveStepStatus((prev) => ({ ...prev, [event.stepIndex]: event }));
    });
    try {
      const results = await window.api.restoreWorkspace(workspace.id);
      onUpdateRestoreState({
        restoreResults: results,
        restoredAt: Date.now(),
        stepIdsAtRestore: workspace.tools.map((t) => t.id),
      });
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      unsubscribe();
      // Unconditional — unlike `restoreError`/`progress` below, this
      // belongs to App.tsx's cache now, not this component instance, so
      // it's just as meaningful to record whether or not this specific
      // Detail instance is still the one mounted.
      onUpdateRestoreState({ isRestoring: false });
      if (isMountedRef.current) {
        setProgress(null);
      }
      // Restoring sets this workspace's intent-active flag server-side
      // (WCs/WC__workspace-activity.md) — refresh so the sidebar/
      // header button reflect it, same as Switch/Close below.
      onWorkspaceActivityChanged();
    }
  }

  /**
   * Full context change: closes whatever's running that this workspace
   * doesn't need, then restores it — see orchestrator.ts's
   * switchToWorkspace. The open side reuses RestoreResults exactly like
   * a normal restore (real StepResult[]); activityLog covers the close
   * side only.
   */
  async function handleSwitch(): Promise<void> {
    onUpdateRestoreState({
      isSwitching: true,
      restoreResults: null,
      restoredAt: null,
      stepIdsAtRestore: null,
      activityLog: null,
      applyError: null,
    });
    setRestoreError(null);
    try {
      const result = await window.api.switchToWorkspace(workspace.id);
      onUpdateRestoreState({
        restoreResults: result.stepResults,
        restoredAt: Date.now(),
        stepIdsAtRestore: workspace.tools.map((t) => t.id),
        activityLog: { closed: result.closed, leftOpen: result.leftOpen },
      });
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      onUpdateRestoreState({ isSwitching: false });
      onWorkspaceActivityChanged();
    }
  }

  /**
   * Closes only this workspace's own apps — see orchestrator.ts's
   * closeWorkspace. Never opens anything, so restoreResults is left
   * alone; only activityLog is relevant here.
   */
  async function handleClose(): Promise<void> {
    onUpdateRestoreState({ isClosing: true, activityLog: null, applyError: null });
    setRestoreError(null);
    try {
      const result = await window.api.closeWorkspace(workspace.id);
      onUpdateRestoreState({ activityLog: { closed: result.closed, leftOpen: result.leftOpen } });
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      onUpdateRestoreState({ isClosing: false });
      onWorkspaceActivityChanged();
    }
  }

  async function handleRetryStep(i: number): Promise<void> {
    // Defensive, not just UI-disabled: a Switch/Close can replace or
    // discard restoreResults out from under an in-flight retry, which
    // would otherwise splice a stale result into an unrelated array
    // once this resolves (see RestoreResults' own `disabled` prop for
    // the button-level half of this fix).
    if (isSwitching || isClosing) return;
    onUpdateRestoreState({ retryingIndex: i });
    let newResult: StepResult;
    try {
      newResult = await window.api.retryWorkspaceStep(workspace.id, i);
    } catch (err) {
      // An unexpected IPC-level failure (e.g. the workspace vanished
      // mid-session) becomes this row's new result too — one consistent
      // "replace in place" outcome for every retry attempt, rather than
      // a second, separate error-banner pattern just for this case.
      newResult = {
        success: false,
        message: err instanceof Error ? err.message : String(err),
        durationMs: 0,
        code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
      };
    }
    // Reads `prev` from inside this functional patch (not the
    // `restoreResults` destructured above, which is a snapshot from
    // whenever THIS render happened) — the same "only mutate if a
    // fresh Restore hasn't already cleared it" safety the original
    // local-state version had, now resolved against App.tsx's actual
    // current value at the moment this update applies, not a stale one
    // captured back when the retry started.
    // Replaced by step id, not position: steps may have been added or
    // removed since the restore these results came from.
    const stepId = workspace.tools[i]?.id;
    onUpdateRestoreState((prev) => ({
      restoreResults: prev.restoreResults
        ? prev.restoreResults.map((r, idx) =>
            stepId !== undefined && prev.stepIdsAtRestore?.[idx] === stepId ? newResult : r,
          )
        : prev.restoreResults,
      retryingIndex: null,
    }));
  }

  // Same conditions the three separate buttons used to gate on — only
  // the presentation changed (one split button instead of three equal-
  // weight ones), not when each action is actually available.
  const hasSwitch = allWorkspaces.some((w) => w.id !== workspace.id && w.active);
  const hasClose = workspace.active;
  const hasRestoreAlternatives = hasSwitch || hasClose;
  const actionsDisabled = isRestoring || isSwitching || isClosing || retryingIndex !== null;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-10 pt-7.5 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif m-0 text-[21px] font-semibold tracking-[-0.015em] text-text">
              {workspace.name}
            </h1>
            {
              // Computed server-side (intent + liveness — see
              // WCs/WC__workspace-activity.md), never a locally-set
              // flag. Always absent on non-macOS (v1 scope). Same
              // pulsing-dot language as the sidebar row's own live
              // indicator (Sidebar.tsx) — here there's room for the
              // label too, unlike that compact list row.
              workspace.active && (
                <span
                  className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.04em] text-success uppercase"
                  title="At least one of this workspace's apps is still open"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex h-full w-full rounded-full bg-success" />
                  </span>
                  Active
                </span>
              )
            }
          </div>
          <p className="mt-1.25 mb-0 text-[13px] text-text-muted">{workspace.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${workspace.name}`}
                // Editing or deleting mid-restore/close/switch would pull the
                // workspace out from under the run in progress.
                disabled={actionsDisabled}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-text-muted transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px hover:bg-bg-hover hover:text-text active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-bg-hover data-[state=open]:text-text"
              >
                <Icon name="more" size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  onEditWorkspace(workspace);
                }}
              >
                <Icon name="pencil" size={13} />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                onSelect={() => {
                  onDeleteWorkspace(workspace);
                }}
              >
                <Icon name="trash" size={13} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {
            // Restore/Switch/Close used to be three separate, equally-
            // weighted buttons — three different answers to the same
            // underlying question ("make this workspace's state true"),
            // competing for attention instead of making the common case
            // (plain Restore) the obvious one. Now a single split
            // button: Restore stays the one-click default, Switch/Close
            // move into its dropdown as secondary, still fully
            // discoverable options — never removed, just no longer
            // fighting Restore for equal visual weight. Direct founder
            // feedback: "too many buttons here, each diff function and
            // user does not know what is what."
          }
          <div className="group flex shrink-0 items-center">
            <button
              className={cn(
                // The lift-on-hover transform now lives on `group-hover`/
                // `group-active` (the wrapping div above, not this
                // button's own `hover`/`active`) — a real UI bug found
                // directly: hovering just the chevron half used to leave
                // this half sitting still while the chevron tried to
                // move on its own (it had no transform at all), visibly
                // breaking apart a control that's supposed to read as
                // one joined button. :hover/:active on a parent already
                // applies whenever any descendant — either button here —
                // is hovered/pressed, so both halves now always move
                // together regardless of which one the mouse is over.
                'flex h-10 items-center gap-1.75 bg-accent px-4 text-[13px] font-bold text-white transition-[transform,filter] duration-150 group-hover:-translate-y-px group-hover:brightness-[1.06] group-active:translate-y-0 disabled:cursor-default disabled:opacity-60',
                hasRestoreAlternatives ? 'rounded-l-md' : 'rounded-md',
              )}
              type="button"
              title={
                workspace.active
                  ? "Re-opens anything of this workspace's that isn't currently running. Already-open apps are left exactly as they are."
                  : undefined
              }
              disabled={actionsDisabled}
              onClick={() => {
                void handleRestore();
              }}
            >
              <Icon name="zap" size={14} />
              {isRestoring
                ? 'Restoring…'
                : isSwitching
                  ? 'Switching…'
                  : isClosing
                    ? 'Closing…'
                    : 'Restore workspace'}
            </button>
            {hasRestoreAlternatives && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More ways to restore this workspace"
                    disabled={actionsDisabled}
                    className="flex h-10 items-center justify-center rounded-r-md border-l border-white/25 bg-accent px-2.5 text-white transition-[transform,filter] duration-150 group-hover:-translate-y-px group-hover:brightness-[1.06] group-active:translate-y-0 disabled:cursor-default disabled:opacity-60"
                  >
                    <Icon name="chevronRight" size={13} className="rotate-90" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80">
                  {hasSwitch && (
                    <DropdownMenuItem
                      className="flex-col items-start gap-0.5 py-2"
                      onSelect={() => {
                        void handleSwitch();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="repeat" size={13} />
                        Switch to this workspace
                      </span>
                      <span className="pl-5 text-[11px] leading-[1.4] text-text-faint">
                        Closes whatever another active workspace opened that this one doesn&rsquo;t
                        need, then restores this one.
                      </span>
                    </DropdownMenuItem>
                  )}
                  {hasClose && (
                    <DropdownMenuItem
                      className="flex-col items-start gap-0.5 py-2"
                      onSelect={() => {
                        void handleClose();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="power" size={13} />
                        Close this workspace
                      </span>
                      <span className="pl-5 text-[11px] leading-[1.4] text-text-faint">
                        Closes just this workspace&rsquo;s own apps. Anything another active
                        workspace still needs stays open.
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4.5 flex flex-wrap gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted">
          <Icon name="check" size={12} className="text-text-faint" /> {workspace.tools.length} tools
        </span>
        <span
          className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted"
          title={workspaceLaunchTimeTooltip(workspace.launchTime)}
        >
          <Icon name="zap" size={12} className="text-text-faint" />{' '}
          {workspaceLaunchTimeLabel(workspace.launchTime)}
        </span>
        <WorkspaceHotkeyControl workspaceId={workspace.id} isMac={isMac} />
      </div>

      <div className="mt-6.5 mb-5.5 h-px bg-border" />

      {isRestoring && progress && (
        <p className="mb-4.5 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
          Step {progress.stepIndex + 1} of {progress.total}
          {progress.status === 'running' ? ' — running…' : ''}
        </p>
      )}
      {restoreError && (
        <div className="mb-5.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <ErrorCode
            message={restoreError.message}
            code={restoreError.code}
            onLearnMore={onShowErrorCode}
          />
        </div>
      )}
      {activityLog && (activityLog.closed.length > 0 || activityLog.leftOpen.length > 0) && (
        <div className="mb-5.5 flex flex-col gap-1.5">
          {activityLog.closed.map((appName) => (
            <div
              key={`closed-${appName}`}
              className="flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted"
            >
              <Icon name="x" size={13} className="text-text-faint" />
              <span>Closed {appName}.</span>
            </div>
          ))}
          {activityLog.leftOpen.map((entry) => {
            const isProblem = entry.reason === 'failed' || entry.reason === 'needs-permission';
            return (
              <div
                key={`left-open-${entry.appName}`}
                className="flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted"
              >
                <Icon
                  name={isProblem ? 'x' : 'check'}
                  size={13}
                  className={isProblem ? 'text-danger' : 'text-text-faint'}
                />
                <span>{describeLeftOpen(entry)}</span>
              </div>
            );
          })}
        </div>
      )}
      {restoreResults && restoredAt !== null && (
        <>
          <RestoreResults
            results={currentResults.map((r) => r.result)}
            tools={currentResults.map((r) => r.step)}
            restoredAt={restoredAt}
          />
          <div className="mt-6.5 mb-5.5 h-px bg-border" />
        </>
      )}

      <p className="mb-4.5 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
        Runs in order on restore
      </p>

      {removeStepError && (
        <div className="mb-4.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <ErrorCode
            message={removeStepError.message}
            code={removeStepError.code}
            onLearnMore={onShowErrorCode}
          />
        </div>
      )}
      {restoreState.applyError !== null && (
        <div className="mb-4.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <ErrorCode
            message={restoreState.applyError}
            code={ERROR_CODES.SYSTEM_UNEXPECTED.code}
            onLearnMore={onShowErrorCode}
          />
        </div>
      )}

      <div className="flex flex-col">
        {workspace.tools.map((tool, i) => {
          // Same "the only three project-directory-shaped step types"
          // scoping as WorkspaceFormModal.tsx, computed fresh per row —
          // steps here are index-identified (no stable key, confirmed
          // earlier this session), so the index doubles as the
          // suggestion's own excludeKey/key.
          const projectPathSuggestion = PROJECT_PATH_STEP_TYPES.has(tool.type)
            ? getProjectPathSuggestion(
                workspace.tools.map((t, idx) => ({ key: idx, type: t.type, params: t.params })),
                i,
              )
            : undefined;
          // The EFFECTIVE directory — the in-progress draft's, while this
          // row is the one being edited, not the workspace's last-saved
          // value. Using tool.params unconditionally here was a real bug:
          // projectFilesDetection stayed permanently locked to whatever
          // directory was saved when the step was last saved, so typing
          // or browsing to a NEW directory while editing never actually
          // got scanned at all, no matter how long you waited — confirmed
          // live (darpiano-front's real docker-compose.yml never got
          // detected after Browse-ing to it on an existing, already-
          // saved step). Mirrors the exact `draftParams ?? tool.params`
          // precedence DockerFields itself already uses internally.
          const effectiveParams = expandedIndex === i ? (draftParams ?? tool.params) : tool.params;
          const directory =
            typeof effectiveParams['directory'] === 'string' ? effectiveParams['directory'] : '';
          return (
            <TimelineStep
              key={tool.id}
              tool={tool}
              index={i}
              isLast={i === workspace.tools.length - 1}
              isOpen={expandedIndex === i}
              onToggle={() => {
                handleToggleStep(i);
              }}
              recentFolders={recentFolders.filter((p) => p !== tool.params['path'])}
              recentCommands={recentCommands}
              spotify={spotify}
              {...(isToolAppKey(tool.type)
                ? { appPathDetection: appPathDetections.forTool(tool.type) }
                : {})}
              draftParams={expandedIndex === i ? draftParams : null}
              onDraftChange={setDraftParams}
              onSave={() => {
                void handleSaveStep(i);
              }}
              onCancel={handleCancelStep}
              isSaving={isSavingStep}
              saveError={expandedIndex === i ? saveStepError : null}
              {...(expandedIndex === i && saveStepError?.fieldErrors
                ? { fieldErrors: saveStepError.fieldErrors }
                : {})}
              {...(projectPathSuggestion ? { projectPathSuggestion } : {})}
              {...(tool.type === 'docker'
                ? { projectFilesDetection: projectFilesDetection.forDirectory(directory) }
                : {})}
              onShowErrorCode={onShowErrorCode}
              onRemove={() => {
                void handleRemoveStep(i);
              }}
              isRemoving={removingIndex === i}
              {...(resultByStepId.has(tool.id) ? { result: resultByStepId.get(tool.id)! } : {})}
              onRetryStep={(j) => {
                void handleRetryStep(j);
              }}
              retryingIndex={retryingIndex}
              retryDisabled={isSwitching || isClosing}
              hasRestoreResults={restoreResults !== null}
              {...(liveStepStatus[i] ? { liveStatus: liveStepStatus[i] } : {})}
            />
          );
        })}
      </div>

      <div className="mt-3">
        <AddToolMenu
          onPick={(preset) => {
            void handleAddStep(preset);
          }}
        >
          <button
            type="button"
            disabled={actionsDisabled || isSavingStep}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-xs text-text-faint hover:border-text-faint hover:text-text-muted disabled:pointer-events-none disabled:opacity-60"
          >
            <Icon name="plus" size={12} />
            Add step
          </button>
        </AddToolMenu>
        {addStepError && (
          <div className="mt-2 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
            <Icon name="x" size={13} className="text-danger" />
            <ErrorCode
              code={addStepError.code}
              message={addStepError.message}
              onLearnMore={onShowErrorCode}
            />
          </div>
        )}
      </div>

      <StepChangeConfirm
        pending={pendingChange}
        onCancel={() => {
          setPendingChange(null);
        }}
        onConfirm={() => {
          const change = pendingChange;
          setPendingChange(null);
          if (change) void confirmPendingChange(change);
        }}
      />
    </main>
  );
}
