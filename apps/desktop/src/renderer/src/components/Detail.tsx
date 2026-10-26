import { useMemo, useState } from 'react';
import type { RestoreProgressEvent, StepResult, WorkspaceConfig } from '@workspace-launcher/shared';
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
import type { WorkspaceRestoreState } from '../lib/workspace-restore-state';
import { TimelineStep } from './TimelineStep';
import { RestoreResults } from './RestoreResults';
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
    toolTypesAtRestore,
    activityLog,
    retryingIndex,
  } = restoreState;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<DisplayError | null>(null);
  const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);

  // Inline quick-edit state — only ever relevant for whichever single
  // step is currently expanded (expandedIndex), same one-at-a-time
  // shape that already governs expand/collapse.
  const [draftParams, setDraftParams] = useState<Record<string, unknown> | null>(null);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [saveStepError, setSaveStepError] = useState<SaveStepDisplayError | null>(null);
  // Removing a single step — independent of the quick-edit state above
  // (a step can be removed whether or not it's currently expanded).
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [removeStepError, setRemoveStepError] = useState<DisplayError | null>(null);
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
    setExpandedIndex((current) => (current === i ? null : i));
    setDraftParams(null);
    setSaveStepError(null);
  }

  /**
   * Returns whether the save actually succeeded — most callers (the
   * Save button itself) don't need this, but `handleRestore` does: it
   * must know whether to proceed with an auto-committed draft or abort
   * the restore entirely, see its own comment on why.
   */
  async function handleSaveStep(i: number): Promise<boolean> {
    if (draftParams === null) return true; // nothing to save is not a failure
    setIsSavingStep(true);
    setSaveStepError(null);
    const steps = replaceStepParams(
      workspace.tools.map((t) => ({ type: t.type, params: t.params })),
      i,
      draftParams,
    );
    try {
      const result = await window.api.updateWorkspace({
        id: workspace.id,
        name: workspace.name,
        steps,
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
      onQuickEditSaved(result.config);
      return true;
    } catch (err) {
      setSaveStepError({
        message: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
      });
      return false;
    } finally {
      setIsSavingStep(false);
    }
  }

  function handleCancelStep(): void {
    setDraftParams(null);
    setSaveStepError(null);
  }

  /**
   * Removes one step entirely and persists immediately — a quick,
   * direct action (no confirmation dialog), matching this app's
   * existing precedent for removing a single item within an
   * already-editing context (WorkspaceFormModal's removeTool,
   * EditableStringList's own remove row) rather than the heavier,
   * confirmed "Delete workspace" flow. If the step being removed is
   * also the currently-expanded one, its quick-edit state is cleared
   * too — nothing left to save/cancel for a step that no longer exists.
   */
  async function handleRemoveStep(i: number): Promise<void> {
    setRemovingIndex(i);
    setRemoveStepError(null);
    const steps = workspace.tools
      .map((t) => ({ type: t.type, params: t.params }))
      .filter((_, index) => index !== i);
    try {
      const result = await window.api.updateWorkspace({
        id: workspace.id,
        name: workspace.name,
        steps,
      });
      if (!isMountedRef.current) return;
      if (!result.success) {
        setRemoveStepError({ message: result.error, code: result.code });
        return;
      }
      if (expandedIndex === i) {
        setExpandedIndex(null);
        setDraftParams(null);
        setSaveStepError(null);
      }
      onQuickEditSaved(result.config);
    } catch (err) {
      if (isMountedRef.current) {
        setRemoveStepError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setRemovingIndex(null);
      }
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
      toolTypesAtRestore: null,
      activityLog: null,
      retryingIndex: null,
    });
    setRestoreError(null);
    setProgress(null);
    // Ignoring events for a different workspace id guards against a
    // stale/overlapping restore: switching workspaces mid-restore
    // remounts this component (key={workspace.id} in App.tsx), but the
    // old restore's promise — and this subscription — keeps running in
    // the background until it resolves.
    const unsubscribe = window.api.onRestoreProgress((event) => {
      if (event.workspaceId !== workspace.id || !isMountedRef.current) return;
      setProgress(event);
    });
    try {
      const results = await window.api.restoreWorkspace(workspace.id);
      onUpdateRestoreState({
        restoreResults: results,
        restoredAt: Date.now(),
        toolTypesAtRestore: workspace.tools.map((t) => t.type),
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
      toolTypesAtRestore: null,
      activityLog: null,
    });
    setRestoreError(null);
    try {
      const result = await window.api.switchToWorkspace(workspace.id);
      onUpdateRestoreState({
        restoreResults: result.stepResults,
        restoredAt: Date.now(),
        toolTypesAtRestore: workspace.tools.map((t) => t.type),
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
    onUpdateRestoreState({ isClosing: true, activityLog: null });
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
    onUpdateRestoreState((prev) => ({
      restoreResults: prev.restoreResults
        ? prev.restoreResults.map((r, idx) => (idx === i ? newResult : r))
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
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-text-muted transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px hover:bg-bg-hover hover:text-text active:translate-y-0 data-[state=open]:bg-bg-hover data-[state=open]:text-text"
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
          {activityLog.leftOpen.map((entry) => (
            <div
              key={`left-open-${entry.appName}`}
              className="flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted"
            >
              <Icon
                name={entry.reason === 'failed' ? 'x' : 'check'}
                size={13}
                className={entry.reason === 'failed' ? 'text-danger' : 'text-text-faint'}
              />
              <span>
                {entry.reason === 'failed'
                  ? `Couldn't close ${entry.appName}${entry.detail ? `: ${entry.detail}` : '.'}`
                  : `Left ${entry.appName} running (${
                      entry.reason === 'excluded'
                        ? 'not auto-closed'
                        : 'still used by another active workspace'
                    }).`}
              </span>
            </div>
          ))}
        </div>
      )}
      {restoreResults && restoredAt !== null && (
        <>
          <RestoreResults
            results={restoreResults}
            tools={workspace.tools}
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
          const directory =
            typeof tool.params['directory'] === 'string' ? tool.params['directory'] : '';
          return (
            <TimelineStep
              key={i}
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
              {...(restoreResults && toolTypesAtRestore?.[i] === tool.type
                ? { result: restoreResults[i] }
                : {})}
              onRetryStep={(j) => {
                void handleRetryStep(j);
              }}
              retryingIndex={retryingIndex}
              retryDisabled={isSwitching || isClosing}
              hasRestoreResults={restoreResults !== null}
            />
          );
        })}
      </div>
    </main>
  );
}
