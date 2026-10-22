import { useEffect, useMemo, useState } from 'react';
import { ERROR_CODES, getStepTypeDefinition, isToolAppKey } from '@workspace-launcher/shared';
import type {
  CreateWorkspaceResult,
  DetectedStepDraft,
  DetectWorkspaceDraftResult,
  UpdateWorkspaceResult,
  WorkspaceConfig,
  WorkspaceStep,
} from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { useIsMounted } from '../lib/useIsMounted';
import { useAppPathDetections } from '../lib/useAppPathDetections';
import { useSpotifyConnection } from '../lib/useSpotifyConnection';
import { getRecentProjectPaths } from '../lib/recent-project-paths';
import { getRecentCommands } from '../lib/recent-commands';
import { findDuplicateWorkspace } from '../lib/workspace-duplicate';
import { getStepFieldsComponent, stepFieldsIsCollapsible } from './step-fields/registry';
import { AppHotkeyControl } from './AppHotkeyControl';
import { ErrorCode } from './ErrorCode';
import { ToolBadge } from './ToolBadge';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface SaveCurrentWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires on a successful save — mirrors WorkspaceFormModal's onSaved. */
  onSaved: (config: WorkspaceConfig) => void;
  onShowErrorCode: (code: string) => void;
  /** Only used to derive vscode/terminal "Recent" suggestions (see
   * lib/recent-project-paths.ts/recent-commands.ts) — same purpose as
   * WorkspaceFormModal's identical prop. */
  workspaces: WorkspaceDisplay[];
}

type Phase = 'loading' | 'blocked' | 'ready' | 'saving' | 'error';

/**
 * Derives a default, editable name with no required typing (this app's
 * standing config-UX rule — docs/build-shell.md) from the most
 * "primary" detected step: a vscode project's own folder name, or a
 * date fallback when nothing more specific was detected (e.g. only
 * generic app steps).
 */
function deriveDefaultName(steps: DetectedStepDraft[]): string {
  const vscodeStep = steps.find((s) => s.type === 'vscode');
  const path = vscodeStep?.params['path'];
  if (typeof path === 'string' && path.length > 0) {
    // Trailing slash(es) stripped first — otherwise `.split('/').pop()`
    // returns '' (falsy) and a perfectly good, just-detected project
    // name is silently discarded in favor of the generic date fallback.
    const base = path.replace(/\/+$/, '').split('/').pop();
    if (base) return base;
  }
  return `Workspace from ${new Date().toLocaleDateString()}`;
}

/**
 * The review screen for "Save my current workspace" (see
 * WCs/WC__save-current-workspace.md) — triggered by the standalone
 * global hotkey, its tray-menu companion, or a manual button. Fetches
 * a fresh detection draft on open, shows every detected step pre-
 * checked with its real tool badge, lets the user exclude any row,
 * expand one to correct its fields inline (the SAME per-type fields
 * components WorkspaceFormModal's own "Edit workspace" flow uses — see
 * step-fields/registry.ts — not a second, parallel editor), or rename
 * the workspace, then hands the checked/edited rows to the EXISTING
 * createWorkspace flow unchanged — no new validation/persistence path.
 */
export function SaveCurrentWorkspaceModal({
  open,
  onClose,
  onSaved,
  onShowErrorCode,
  workspaces,
}: SaveCurrentWorkspaceModalProps): JSX.Element {
  const isMountedRef = useIsMounted();
  const [phase, setPhase] = useState<Phase>('loading');
  const [draft, setDraft] = useState<DetectWorkspaceDraftResult | null>(null);
  const [name, setName] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Editable copy of each detected step's params, parallel-indexed to
  // draft.steps — the draft itself is never mutated, so a stale re-fetch
  // or re-derivation never clobbers an in-progress edit.
  const [stepParams, setStepParams] = useState<Record<string, unknown>[]>([]);
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());
  const [saveError, setSaveError] = useState<{ message: string; code?: string } | null>(null);

  // Same altitude/instantiation pattern as WorkspaceFormModal: owned
  // once for this modal's lifetime, threaded down to each row's fields
  // component — a row's install-detection or Spotify connection state
  // must agree across every row of the same type, not be re-derived
  // per row.
  const appPathDetections = useAppPathDetections();
  const spotify = useSpotifyConnection();
  const isMac = window.api.platform === 'darwin';

  useEffect(() => {
    if (!open) return;
    // This modal stays mounted for the app's whole session (only `open`
    // toggles) — isMountedRef alone never goes false between an open
    // and a later reopen, so it can't guard against a STALE response:
    // close-then-reopen before the first detectCurrentWorkspace() call
    // resolves would otherwise let that earlier promise overwrite a
    // second, fresher one. `cancelled`, re-created fresh per effect run
    // (i.e. per open), is what actually prevents that.
    let cancelled = false;
    setPhase('loading');
    setDraft(null);
    setOpenIndices(new Set());
    setSaveError(null);
    void window.api.detectCurrentWorkspace().then((result) => {
      if (cancelled || !isMountedRef.current) return;
      setDraft(result);
      if (result.status === 'blocked') {
        setPhase('blocked');
        return;
      }
      setName(deriveDefaultName(result.steps));
      setChecked(new Set(result.steps.map((_, i) => i)));
      setStepParams(result.steps.map((s) => s.params));
      setPhase('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [open, isMountedRef]);

  function toggleStep(index: number): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleOpen(index: number): void {
    setOpenIndices((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  /** Merges a partial update into one step's params — mirrors
   * WorkspaceFormModal's own updateStepParams exactly: every fields
   * component's onChange hands back only what changed, not the whole
   * params object. */
  function updateStepParams(index: number, partial: Record<string, unknown>): void {
    setStepParams((current) =>
      current.map((params, i) => (i === index ? { ...params, ...partial } : params)),
    );
  }

  const steps: WorkspaceStep[] = useMemo(() => {
    if (!draft || draft.status !== 'ready') return [];
    return draft.steps
      .map((s, i) => ({ type: s.type, params: stepParams[i] ?? s.params }))
      .filter((_, i) => checked.has(i));
  }, [draft, stepParams, checked]);

  // Re-detected every render from `name`/`steps` directly (not stored as
  // its own state) — this is exactly what makes it self-correct the
  // instant the user renames the workspace or unchecks a step, with no
  // separate "now stale" tracking needed. Comfortable duplicate
  // prevention, not a scary blocking error: surfaced as information with
  // an easy alternative below, never a forced extra click to do what the
  // user actually came here to do (see findDuplicateWorkspace's own
  // "name AND steps, both" doc comment for why this only fires on a
  // real, exact duplicate, never a loose name-only match).
  const duplicateOf = useMemo(
    () => (name.trim() ? findDuplicateWorkspace({ name, steps }, workspaces) : undefined),
    [name, steps, workspaces],
  );

  async function handleSave(): Promise<void> {
    if (!draft || draft.status !== 'ready') return;
    setPhase('saving');
    setSaveError(null);
    try {
      const result: CreateWorkspaceResult = await window.api.createWorkspace({ name, steps });
      if (!isMountedRef.current) return;
      if (!result.success) {
        setSaveError({ message: result.error, code: result.code });
        setPhase('ready');
        return;
      }
      // Everything in a live-detected draft is, by construction,
      // already running — see ipc/handlers.ts's markWorkspaceActive.
      // Best-effort: a failure here only means the "Active" badge won't
      // show immediately (it self-corrects on the next liveness check),
      // never a reason to treat an otherwise-successful save as failed.
      await window.api.markWorkspaceActive(result.config.id).catch(() => {});
      if (!isMountedRef.current) return;
      onSaved(result.config);
      onClose();
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
        setPhase('ready');
      }
    }
  }

  /** The duplicate banner's offered alternative: replace the existing
   * identical workspace's steps instead of creating a second, literally
   * identical copy of it — the actual fix for "I saved twice in a row,"
   * not just a warning about it. */
  async function handleUpdateExisting(): Promise<void> {
    if (!duplicateOf) return;
    setPhase('saving');
    setSaveError(null);
    try {
      const result: UpdateWorkspaceResult = await window.api.updateWorkspace({
        id: duplicateOf.id,
        name,
        steps,
      });
      if (!isMountedRef.current) return;
      if (!result.success) {
        setSaveError({ message: result.error, code: result.code });
        setPhase('ready');
        return;
      }
      await window.api.markWorkspaceActive(result.config.id).catch(() => {});
      if (!isMountedRef.current) return;
      onSaved(result.config);
      onClose();
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
        setPhase('ready');
      }
    }
  }

  const isSaving = phase === 'saving';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSaving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-150"
        {...(draft && draft.status === 'ready' && !isSaving && draft.steps.length > 0
          ? {
              onEnterKey: () => {
                void handleSave();
              },
            }
          : {})}
      >
        <DialogHeader>
          <DialogTitle>Save current workspace</DialogTitle>
          <DialogClose
            disabled={isSaving}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {
            // Right at the top, not buried in Settings (where this
            // exact kind of control went unnoticed once already — see
            // WorkspaceHotkeyControl's own history) — this is the
            // trigger for the screen you're already looking at, so the
            // control for it belongs right here. The SAME
            // AppHotkeyControl instance Settings also renders (it
            // already has its own label + description, built for a
            // Settings row — reused as-is here, not re-wrapped in a
            // second label) — both just read/write the one real
            // persisted binding via window.api, so there's no separate
            // state to keep "in sync": whichever one you look at next
            // always reflects whatever the other last set.
          }
          <div className="mb-4.5 rounded-sm border border-border bg-bg-elevated px-2.75 py-2">
            <AppHotkeyControl isMac={isMac} />
          </div>

          {phase === 'loading' && (
            <div className="flex items-center gap-2 py-6 text-[12.5px] text-text-muted">
              <Icon name="refresh" size={14} className="animate-spin" />
              Detecting what&rsquo;s currently open…
            </div>
          )}

          {phase === 'blocked' && (
            <div className="flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
              <Icon name="x" size={13} className="text-danger" />
              A workspace is already being restored, switched, or closed — try again in a moment.
            </div>
          )}

          {draft && draft.status === 'ready' && (
            <>
              <p className="mb-1.5 text-xs font-medium text-text-muted">Workspace name</p>
              <div className="mb-4.5">
                <input
                  className="h-8.5 w-full rounded-sm border border-border-strong bg-bg-elevated px-2.75 text-[13px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
                {duplicateOf && (
                  // Informational, never blocking — the main Save button
                  // below still saves a new workspace with one click
                  // regardless, same as if this weren't shown at all.
                  // Only fires on a real, exact duplicate (same name AND
                  // same steps — see findDuplicateWorkspace's own doc
                  // comment), never a loose name-only match, so this
                  // can't nag over an intentional near-duplicate.
                  <div className="mt-2.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12px] text-text-muted">
                    <Icon name="info" size={13} className="shrink-0 text-text-faint" />
                    <span className="flex-1">
                      Identical to the existing &ldquo;{duplicateOf.name}&rdquo; workspace.
                    </span>
                    <button
                      type="button"
                      disabled={isSaving}
                      className="shrink-0 text-[11.5px] font-medium text-accent hover:underline disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => {
                        void handleUpdateExisting();
                      }}
                    >
                      Update it instead
                    </button>
                  </div>
                )}
              </div>

              {draft.issues.length > 0 && (
                <div className="mb-3 flex flex-col gap-1.5">
                  {draft.issues.map((issue) => (
                    <div
                      key={issue}
                      className="flex items-start gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12px] text-text-muted"
                    >
                      <Icon name="x" size={12} className="mt-0.5 shrink-0 text-danger" />
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}

              {draft.steps.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-text-faint">
                  Nothing recognizable is currently open.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {draft.steps.map((step, i) => {
                    // Every type this feature ever produces (vscode/
                    // chrome/spotify/clockify/terminal/app) already has
                    // a real STEP_TYPES entry — the fallback below is
                    // defensive only, never expected to trigger.
                    const def = getStepTypeDefinition(step.type);
                    const params = stepParams[i] ?? step.params;
                    const FieldsComponent = getStepFieldsComponent(step.type);
                    const collapsible = stepFieldsIsCollapsible(step.type) && FieldsComponent !== undefined;
                    const isOpen = collapsible && openIndices.has(i);

                    return (
                      <div
                        key={`${step.type}-${i}`}
                        className="rounded-sm border border-border bg-bg-elevated"
                      >
                        <div
                          className={cn(
                            'flex items-center gap-3 px-2.75 py-2.5 text-[12.5px]',
                            collapsible && 'cursor-pointer',
                          )}
                          onClick={
                            collapsible
                              ? () => {
                                  toggleOpen(i);
                                }
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(i)}
                            onClick={(e) => {
                              // Checking/unchecking must never also
                              // toggle this row's expand state — the two
                              // are independent controls sharing one row.
                              e.stopPropagation();
                            }}
                            onChange={() => {
                              toggleStep(i);
                            }}
                          />
                          <ToolBadge
                            type={step.type}
                            icon={def?.icon ?? 'app'}
                            color={def?.color ?? 'zinc'}
                            size={26}
                            chipClassName="h-12 w-12 text-[26px]"
                            params={params}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-text">{step.label}</span>
                            {step.caveat && (
                              <span className="text-[11px] text-text-faint">{step.caveat}</span>
                            )}
                          </span>
                          {collapsible && (
                            <span
                              className={cn(
                                'flex h-5.5 w-5.5 shrink-0 items-center justify-center text-text-faint transition-transform duration-140',
                                isOpen && 'rotate-90',
                              )}
                            >
                              <Icon name="chevronRight" size={13} />
                            </span>
                          )}
                        </div>

                        {isOpen && FieldsComponent && (
                          <div className="border-t border-border px-2.75 py-2.5 pl-11.5">
                            <FieldsComponent
                              params={params}
                              onChange={(next) => {
                                updateStepParams(i, next);
                              }}
                              registerPrimaryInputRef={() => {
                                // No "just added, focus it" concept on
                                // this screen (unlike WorkspaceFormModal's
                                // Add-tool flow) — every row already has
                                // real detected data by the time it can
                                // be expanded.
                              }}
                              recentFolders={getRecentProjectPaths(workspaces, params['path'] as string | undefined)}
                              recentCommands={getRecentCommands(workspaces)}
                              spotify={spotify}
                              {...(isToolAppKey(step.type)
                                ? { appPathDetection: appPathDetections.forTool(step.type) }
                                : {})}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {draft.unmatched.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-medium text-text-faint uppercase">
                    Not included
                  </p>
                  <div className="flex flex-col gap-1">
                    {draft.unmatched.map((app, i) => (
                      <div
                        key={`${app.name}-${i}`}
                        className="rounded-sm border border-border px-2.5 py-1.5 text-[12px] text-text-faint"
                      >
                        {app.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {saveError && (
                <div className="mt-3.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
                  <Icon name="x" size={13} className="text-danger" />
                  <ErrorCode
                    message={saveError.message}
                    code={saveError.code}
                    onLearnMore={onShowErrorCode}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <DialogClose
            disabled={isSaving}
            className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            Cancel
          </DialogClose>
          {draft && draft.status === 'ready' && (
            <button
              className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
              type="button"
              disabled={isSaving || draft.steps.length === 0}
              onClick={() => {
                void handleSave();
              }}
            >
              {isSaving ? 'Saving…' : duplicateOf ? 'Save as new anyway' : 'Save workspace'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
