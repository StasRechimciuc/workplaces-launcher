import { useMemo, useState } from 'react';
import type {
  LeftOpenEntry,
  RestoreProgressEvent,
  StepResult,
  WorkspaceConfig,
} from '@workspace-launcher/shared';
import { ERROR_CODES } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { useIsMounted } from '../lib/useIsMounted';
import { getRecentProjectPaths } from '../lib/recent-project-paths';
import { workspaceLaunchTimeLabel, workspaceLaunchTimeTooltip } from '../lib/launch-time-display';
import { replaceStepParams } from '../lib/replace-step-params';
import { useSpotifyConnection } from '../lib/useSpotifyConnection';
import { TimelineStep } from './TimelineStep';
import { RestoreResults } from './RestoreResults';
import { ErrorCode } from './ErrorCode';

/** A message paired with its (possibly absent) error code — the shape
 * every locally-owned error-display state in this component uses, so
 * the code travels alongside the message instead of being dropped. */
interface DisplayError {
  message: string;
  code?: string;
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
}

/**
 * Render key is the workspace id (see App.tsx) — React remounts this
 * component on workspace switch, which naturally resets expandedIndex
 * (and restore state) to their initial values, same as the mockup's
 * manual `expandedIndex = null` reset.
 */
export function Detail({
  workspace,
  allWorkspaces,
  onEditWorkspace,
  onDeleteWorkspace,
  onQuickEditSaved,
  onShowErrorCode,
  onWorkspaceActivityChanged,
}: DetailProps): JSX.Element {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [restoreResults, setRestoreResults] = useState<StepResult[] | null>(null);
  const [restoreError, setRestoreError] = useState<DisplayError | null>(null);
  // Switch/Close's own close report — "what got closed, what was left
  // running and why." Switch's opened-side instead feeds the same
  // restoreResults state above, via its real StepResult[] (RestoreResults
  // renders those unchanged, since `open -a` is already idempotent for
  // anything already running — see orchestrator.ts's switchToWorkspace).
  const [activityLog, setActivityLog] = useState<{
    closed: string[];
    leftOpen: LeftOpenEntry[];
  } | null>(null);
  const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);
  // Index of the step currently being retried — only ever set once a
  // restore has already finished (restoreResults is non-null), per the
  // founder's settled call that retry doesn't need to be reachable
  // mid-restore.
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);

  // Inline quick-edit state — only ever relevant for whichever single
  // step is currently expanded (expandedIndex), same one-at-a-time
  // shape that already governs expand/collapse.
  const [draftParams, setDraftParams] = useState<Record<string, unknown> | null>(null);
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [saveStepError, setSaveStepError] = useState<DisplayError | null>(null);
  const recentFolders = useMemo(() => getRecentProjectPaths(allWorkspaces), [allWorkspaces]);
  // Independently instantiated from WorkspaceFormModal's own instance —
  // it's cheap and self-contained (status is a no-network local read,
  // see useSpotifyConnection.ts's own doc comment), not worth lifting
  // to App.tsx just to share between two consumers.
  const spotify = useSpotifyConnection();

  function handleToggleStep(i: number): void {
    setExpandedIndex((current) => (current === i ? null : i));
    setDraftParams(null);
    setSaveStepError(null);
  }

  async function handleSaveStep(i: number): Promise<void> {
    if (draftParams === null) return;
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
        setSaveStepError({ message: result.error, code: result.code });
        return;
      }
      setDraftParams(null);
      onQuickEditSaved(result.config);
    } catch (err) {
      setSaveStepError({
        message: err instanceof Error ? err.message : String(err),
        code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
      });
    } finally {
      setIsSavingStep(false);
    }
  }

  function handleCancelStep(): void {
    setDraftParams(null);
    setSaveStepError(null);
  }

  // Restoring a workspace (Docker/Tilt in particular) can take seconds.
  // If the user switches to a different workspace before it resolves,
  // App.tsx's key={workspace.id} unmounts this instance — without this
  // guard, the setState calls below would be no-ops on an unmounted
  // component and the restore's real result (which did happen — a
  // container may have actually started) would silently vanish instead
  // of surfacing anywhere.
  const isMountedRef = useIsMounted();

  async function handleRestore(): Promise<void> {
    setIsRestoring(true);
    setRestoreResults(null);
    setRestoreError(null);
    setActivityLog(null);
    setProgress(null);
    // A fresh full restore makes any in-flight retry from the previous
    // results moot — without this, a retry that resolves after the new
    // restore starts would otherwise leave retryingIndex stuck non-null
    // forever (its own setRestoreResults call becomes a no-op once
    // restoreResults has been reset to null above), wrongly disabling
    // every Retry button on the new results once they arrive.
    setRetryingIndex(null);
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
      if (isMountedRef.current) {
        setRestoreResults(results);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      unsubscribe();
      if (isMountedRef.current) {
        setIsRestoring(false);
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
    setIsSwitching(true);
    setRestoreResults(null);
    setRestoreError(null);
    setActivityLog(null);
    try {
      const result = await window.api.switchToWorkspace(workspace.id);
      if (isMountedRef.current) {
        setRestoreResults(result.stepResults);
        setActivityLog({ closed: result.closed, leftOpen: result.leftOpen });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSwitching(false);
      }
      onWorkspaceActivityChanged();
    }
  }

  /**
   * Closes only this workspace's own apps — see orchestrator.ts's
   * closeWorkspace. Never opens anything, so restoreResults is left
   * alone; only activityLog is relevant here.
   */
  async function handleClose(): Promise<void> {
    setIsClosing(true);
    setActivityLog(null);
    setRestoreError(null);
    try {
      const result = await window.api.closeWorkspace(workspace.id);
      if (isMountedRef.current) {
        setActivityLog({ closed: result.closed, leftOpen: result.leftOpen });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsClosing(false);
      }
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
    setRetryingIndex(i);
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
    if (isMountedRef.current) {
      setRestoreResults((prev) => (prev ? prev.map((r, idx) => (idx === i ? newResult : r)) : prev));
      setRetryingIndex(null);
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-10 pt-7.5 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="m-0 text-[21px] font-semibold tracking-[-0.01em] text-text">
            {workspace.name}
          </h1>
          <p className="mt-1.25 mb-0 text-[13px] text-text-muted">{workspace.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${workspace.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-transparent text-[15px] text-text-muted hover:bg-bg-hover hover:text-text data-[state=open]:bg-bg-hover data-[state=open]:text-text"
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
          {allWorkspaces.some((w) => w.id !== workspace.id && w.active) && (
            // Shown whenever another workspace is currently active —
            // regardless of whether THIS one is too (switching away
            // from a workspace that's part of an A+B parallel session
            // is a real, distinct case from closing just this one —
            // see WCs/WC__workspace-activity.md).
            <button
              className="flex h-8.5 items-center gap-1.75 rounded-md border border-accent-border bg-transparent px-3.5 text-[13px] font-semibold text-accent transition-colors duration-120 hover:bg-accent-soft disabled:cursor-default disabled:opacity-60"
              type="button"
              title="Closes whatever another active workspace opened that this one doesn't need, then restores this one."
              disabled={isRestoring || isSwitching || isClosing || retryingIndex !== null}
              onClick={() => {
                void handleSwitch();
              }}
            >
              <Icon name="repeat" size={14} />
              {isSwitching ? 'Switching…' : 'Switch to this workspace'}
            </button>
          )}
          {
            // Deliberately ADDITIVE, not a replacement for Restore
            // below — Restore stays available even while this
            // workspace is Active, so a partially-crashed workspace
            // (one app quit outside this app, another still open) can
            // still be repaired with one click (open -a is idempotent
            // for whatever's already running) instead of forcing a
            // Close-then-Restore round trip.
            workspace.active && (
              <button
                className="flex h-8.5 items-center gap-1.75 rounded-md border border-border-strong bg-transparent px-3.75 text-[13px] font-semibold text-text transition-colors duration-120 hover:bg-bg-hover disabled:cursor-default disabled:opacity-60"
                type="button"
                title="Closes just this workspace's own apps. Anything another active workspace still needs stays open."
                disabled={isRestoring || isSwitching || isClosing || retryingIndex !== null}
                onClick={() => {
                  void handleClose();
                }}
              >
                <Icon name="power" size={14} />
                {isClosing ? 'Closing…' : 'Close this workspace'}
              </button>
            )
          }
          <button
            className="flex h-8.5 items-center gap-1.75 rounded-md bg-accent px-3.75 text-[13px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_6px_16px_-6px_rgba(99,102,241,0.55)] transition-colors duration-120 hover:bg-accent-hover active:translate-y-px disabled:cursor-default disabled:opacity-60"
            type="button"
            title={
              workspace.active
                ? "Re-opens anything of this workspace's that isn't currently running. Already-open apps are left exactly as they are."
                : undefined
            }
            disabled={isRestoring || isSwitching || isClosing || retryingIndex !== null}
            onClick={() => {
              void handleRestore();
            }}
          >
            <Icon name="zap" size={14} />
            {isRestoring ? 'Restoring…' : 'Restore workspace'}
          </button>
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
          <ErrorCode message={restoreError.message} code={restoreError.code} onLearnMore={onShowErrorCode} />
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
      {restoreResults && (
        <>
          <RestoreResults
            results={restoreResults}
            onRetryStep={(i) => {
              void handleRetryStep(i);
            }}
            retryingIndex={retryingIndex}
            disabled={isSwitching || isClosing}
            onShowErrorCode={onShowErrorCode}
          />
          <div className="mt-6.5 mb-5.5 h-px bg-border" />
        </>
      )}

      <p className="mb-4.5 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
        Runs in order on restore
      </p>

      <div className="flex flex-col">
        {workspace.tools.map((tool, i) => (
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
            spotify={spotify}
            draftParams={expandedIndex === i ? draftParams : null}
            onDraftChange={setDraftParams}
            onSave={() => {
              void handleSaveStep(i);
            }}
            onCancel={handleCancelStep}
            isSaving={isSavingStep}
            saveError={expandedIndex === i ? saveStepError : null}
            onShowErrorCode={onShowErrorCode}
          />
        ))}
      </div>
    </main>
  );
}
