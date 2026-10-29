import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appDisplayName, ERROR_CODES, isToolAppKey } from '@workspace-launcher/shared';
import type {
  CreateWorkspaceResult,
  UpdateWorkspaceResult,
  WorkspaceConfig,
  WorkspaceStepInput,
} from '@workspace-launcher/shared';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../../preload';
import { Icon } from '../icons';
import { CREATE_TOOL_PRESETS, type CreateToolPreset } from '../constants';
import { useIsMounted } from '../lib/useIsMounted';
import { getRecentProjectPaths } from '../lib/recent-project-paths';
import { getRecentCommands } from '../lib/recent-commands';
import { findDuplicateWorkspace } from '../lib/workspace-duplicate';
import { matchesCombo } from '../lib/useGlobalShortcuts';
import { SHORTCUTS, getEffectiveShortcuts, getStoredOverrides } from '../lib/shortcuts';
import { useSpotifyConnection } from '../lib/useSpotifyConnection';
import { useAppPathDetections } from '../lib/useAppPathDetections';
import { useProjectFilesDetection } from '../lib/useProjectFilesDetection';
import { PROJECT_PATH_STEP_TYPES, getProjectPathSuggestion } from '../lib/project-path-suggestion';
import { cn } from '../lib/utils';
import {
  getStepFieldsComponent,
  stepFieldsHasPrimaryInput,
  stepFieldsIsCollapsible,
  stepRowSummary,
} from './step-fields/registry';
import type { StepFieldsProps } from './step-fields/types';
import { ToolBadge } from './ToolBadge';
import { ErrorCode } from './ErrorCode';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { StepChangeConfirm } from './StepChangeConfirm';
import { withStepIdsOf } from '../lib/workspace-duplicate';

interface WorkspaceFormModalProps {
  open: boolean;
  /** null = create mode; a workspace = editing that one. */
  editingWorkspace: WorkspaceDisplay | null;
  /** All saved workspaces (including the one being edited, if any) —
   * used only to derive the VS Code step's "Recent" folder suggestions
   * (see lib/recent-project-paths.ts). */
  workspaces: WorkspaceDisplay[];
  onClose: () => void;
  /** Fires on a successful save in either mode. */
  onSaved: (config: WorkspaceConfig) => void;
  /** Opens ErrorsModal (App.tsx-owned) targeting a specific error code
   * — the save-error banner's "Learn more about this error" link. */
  onShowErrorCode: (code: string) => void;
}

/**
 * One row in the "Tools" list (runs in the order added) — a preset (icon/
 * color/name/type from CREATE_TOOL_PRESETS) plus whatever params the
 * user has entered for that specific row. `key` is a stable identity
 * independent of the row's position in the array: removing an earlier
 * row must not reattach a later row's already-typed params to the
 * wrong preset, which a plain array index would risk the moment any
 * row before it is removed.
 */
interface CreateStepDraft {
  key: number;
  /** The saved step's id when editing one that exists; absent for a
   * row added in this form — the main process assigns it on save. */
  id?: string;
  preset: CreateToolPreset;
  params: Record<string, unknown>;
}

/**
 * Seeded by explicit type, not position — CREATE_TOOL_PRESETS[0]/[1]
 * previously seeded every new workspace with a VS Code row plus
 * whatever STEP_TYPES' 2nd entry happened to be (Docker), which has no
 * registered ToolPlugin and renders with no input fields and no "Soon"
 * badge on an already-added row (that badge only appears in the Add-
 * tool picker) — a default row that silently always fails on restore,
 * with nothing in the form telling the user why. vscode + chrome are
 * both real, implemented Tier 1 tools; the `!` is safe because
 * STEP_TYPES always defines both (see packages/shared/src/step-types.ts).
 */
function initialDrafts(nextKeyRef: { current: number }): CreateStepDraft[] {
  const defaultTypes = ['vscode', 'chrome'];
  return defaultTypes.map((type) => ({
    key: nextKeyRef.current++,
    preset: CREATE_TOOL_PRESETS.find((p) => p.type === type)!,
    params: {},
  }));
}

/**
 * Maps a saved step back to the preset that renders/edits it. Falls
 * back to a one-off preset built from the tool's own already-resolved
 * icon/name/color (config/workspace-display.ts) when the step's type
 * isn't one of today's Tier 1 presets (e.g. a hand-edited or
 * older/foreign config file) — Edit must still open, not refuse.
 */
function presetForTool(tool: WorkspaceToolStepDisplay): CreateToolPreset {
  const known = CREATE_TOOL_PRESETS.find((p) => p.type === tool.type);
  if (known) {
    return known;
  }
  return {
    type: tool.type,
    icon: tool.icon,
    color: tool.color,
    // Not one of the known Tier 1 types (checked above), so there's no
    // ToolPlugin registration to point to either way — false is the
    // honest default rather than guessing.
    implemented: false,
    name: tool.name,
    config: tool.detail,
  };
}

function draftsFromWorkspace(
  workspace: WorkspaceDisplay,
  nextKeyRef: { current: number },
): CreateStepDraft[] {
  return workspace.tools.map((tool) => ({
    key: nextKeyRef.current++,
    id: tool.id,
    preset: presetForTool(tool),
    params: { ...tool.params },
  }));
}

interface ToolPickerItemProps {
  preset: CreateToolPreset;
  onSelect: () => void;
}

/**
 * One row in the "Add tool" picker — the same icon-badge + name + hint
 * visual language as a row already added to the Tools list below (not
 * a bare text menu item), plus a "Soon" pill (Sidebar.tsx's existing
 * "Beta" pill styling) for a Tier 1 type with no ToolPlugin registered
 * yet. Never blocks selection either way — picking a "Soon" preset is
 * allowed, consistent with this app's existing honest-not-blocking
 * convention for unbuilt step types.
 */
function ToolPickerItem({ preset, onSelect }: ToolPickerItemProps): JSX.Element {
  return (
    <DropdownMenuItem className="flex-col items-start gap-0 py-2" onSelect={onSelect}>
      <div className="flex w-full items-center gap-2.5">
        {/* No params to show here — this is the picker preview, before
            any app is chosen, so the 'app' type just falls back to its
            generic icon, which is correct: showing some arbitrary
            previous/stale icon here would be misleading. */}
        <ToolBadge
          type={preset.type}
          icon={preset.icon}
          color={preset.color}
          size={13}
          chipClassName="h-6 w-6 text-[13px]"
          params={{}}
        />
        <span className="text-[12.5px] font-medium text-text">{preset.name}</span>
        {!preset.implemented && (
          <span className="ml-auto rounded-[5px] border border-border-strong px-1.25 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-text-faint uppercase">
            Soon
          </span>
        )}
      </div>
      <span className="pl-8.5 text-[11.5px] text-text-faint">{preset.config}</span>
    </DropdownMenuItem>
  );
}

interface StepParamsFieldsProps {
  preset: CreateToolPreset;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  registerPrimaryInputRef: (el: HTMLInputElement | null) => void;
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only vscode-fields.tsx currently reads it. */
  recentFolders?: string[];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only terminal-fields.tsx currently reads it. */
  recentCommands?: string[];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only spotify-fields.tsx currently reads it. */
  spotify?: StepFieldsProps['spotify'];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only vscode/chrome/spotify/clockify-fields.tsx read it. */
  appPathDetection?: StepFieldsProps['appPathDetection'];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only for the one row a save attempt actually failed on. */
  fieldErrors?: StepFieldsProps['fieldErrors'];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only vscode/docker/terminal-fields.tsx read it. */
  projectPathSuggestion?: StepFieldsProps['projectPathSuggestion'];
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only docker-fields.tsx reads it. */
  projectFilesDetection?: StepFieldsProps['projectFilesDetection'];
}

/**
 * Renders the per-tool param inputs for one "Tools" row, dispatched
 * through step-fields/registry.ts's type-keyed lookup instead of a
 * hand-written `if (preset.type === X)` chain — a new tool type's own
 * fields component means adding an entry to that registry, not editing
 * this component.
 */
function StepParamsFields({
  preset,
  params,
  onChange,
  registerPrimaryInputRef,
  recentFolders,
  recentCommands,
  spotify,
  appPathDetection,
  fieldErrors,
  projectPathSuggestion,
  projectFilesDetection,
}: StepParamsFieldsProps): JSX.Element | null {
  const Fields = getStepFieldsComponent(preset.type);
  if (!Fields) {
    return null;
  }
  return (
    <Fields
      params={params}
      onChange={onChange}
      registerPrimaryInputRef={registerPrimaryInputRef}
      {...(recentFolders !== undefined ? { recentFolders } : {})}
      {...(recentCommands !== undefined ? { recentCommands } : {})}
      {...(spotify !== undefined ? { spotify } : {})}
      {...(appPathDetection !== undefined ? { appPathDetection } : {})}
      {...(fieldErrors !== undefined ? { fieldErrors } : {})}
      {...(projectPathSuggestion !== undefined ? { projectPathSuggestion } : {})}
      {...(projectFilesDetection !== undefined ? { projectFilesDetection } : {})}
    />
  );
}

export function WorkspaceFormModal({
  open,
  editingWorkspace,
  workspaces,
  onClose,
  onSaved,
  onShowErrorCode,
}: WorkspaceFormModalProps): JSX.Element {
  const nextKeyRef = useRef(0);
  const [name, setName] = useState('');
  const [createSteps, setCreateSteps] = useState<CreateStepDraft[]>(() =>
    initialDrafts(nextKeyRef),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<{
    message: string;
    code?: string;
    /** The failing row's stable CreateStepDraft key — not the backend's
     * own `stepIndex`, which only means something against `createSteps`'
     * current order at the moment of that specific save attempt. */
    stepKey?: number;
    fieldErrors?: Record<string, string>;
  } | null>(null);
  // StepChangeConfirm: a row's ✕ or Save waiting for the user's answer,
  // and what's already been confirmed via ✕ — Save never asks about
  // that again, and closes it once saved.
  const [pendingChange, setPendingChange] = useState<
    | { action: 'remove'; key: number; closes: string[] }
    | { action: 'save'; closes: string[] }
    | null
  >(null);
  const [confirmedCloses, setConfirmedCloses] = useState<ReadonlySet<string>>(new Set());
  // Which rows show their fields expanded, keyed by CreateStepDraft.key
  // (stable across reorders/removals, unlike an array index). Collapsed
  // by default — both fresh defaults and an existing workspace's saved
  // steps — since the whole point is to not force-open every row's
  // fields just to glance at the Tools list. Only meaningful for
  // collapsible types (stepFieldsIsCollapsible); a non-collapsible
  // type's key may still end up in here (e.g. via addTool) but nothing
  // reads it for that case.
  const [openKeys, setOpenKeys] = useState<Set<number>>(new Set());

  // The Add-tool picker's own open state (controlled, not left to
  // Radix's default uncontrolled mode) purely so its search query can
  // be reset to '' on close — nothing else here depends on reading it.
  const [isAddToolOpen, setIsAddToolOpen] = useState(false);
  const [toolSearchQuery, setToolSearchQuery] = useState('');
  const toolSearchInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isMac = window.api.platform === 'darwin';
  const filteredToolPresets = useMemo(() => {
    const q = toolSearchQuery.toLowerCase();
    return q
      ? CREATE_TOOL_PRESETS.filter((p) => p.name.toLowerCase().includes(q))
      : CREATE_TOOL_PRESETS;
  }, [toolSearchQuery]);

  // Plain `autoFocus` loses the race against Radix's own internal
  // FocusScope, which auto-focuses the first menu item the instant the
  // content mounts (`onOpenAutoFocus` would prevent that, but it's
  // deliberately excluded from DropdownMenuContent's public prop type
  // — confirmed by reading @radix-ui/react-menu's own source, not
  // assumed). This effect runs after that child-level focus-scope
  // effect has already committed (child effects fire before parent
  // effects), so it reliably "steals" focus back to the search box one
  // tick later instead.
  useEffect(() => {
    if (isAddToolOpen) {
      const frame = requestAnimationFrame(() => {
        toolSearchInputRef.current?.focus();
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
  }, [isAddToolOpen]);

  // Base list of every distinct VS Code path already saved across all
  // workspaces — computed once per workspaces change, not per row.
  // Each row further excludes its OWN current path at the render call
  // site below (a cheap inline filter, not a second memo — createSteps
  // rows already get fresh params every render).
  const recentFolders = useMemo(() => getRecentProjectPaths(workspaces), [workspaces]);

  // Same precedent as recentFolders above — each terminal card further
  // excludes its OWN already-added commands at the render call site in
  // terminal-fields.tsx itself (per-card, not per-row here).
  const recentCommands = useMemo(() => getRecentCommands(workspaces), [workspaces]);

  // Instantiated once per modal mount, not per row — see
  // lib/useSpotifyConnection.ts's own doc comment for why connection
  // state can't live at SpotifyFields' own (per-row) altitude.
  const spotify = useSpotifyConnection();

  // Same "once per modal mount" reasoning as spotify above, for a
  // different cause: a row's fields block fully unmounts on collapse
  // (see `hasFields && isOpen` below), so detection state owned by
  // ResolvedAppPath.tsx itself would re-fetch on every single
  // re-expand. Keyed by tool type, not by row — two VS Code steps in
  // one workspace share one detection, never a second redundant scan.
  const appPathDetections = useAppPathDetections();

  // Same lifted-to-survive-collapse reasoning as appPathDetections
  // above, keyed by directory string instead of tool type — only
  // Docker's own fields component reads this.
  const projectFilesDetection = useProjectFilesDetection();

  // Populated for whichever type's row renders a primary field via
  // StepParamsFields' `registerPrimaryInputRef` prop — vscode's path,
  // chrome's profile, spotify's playlist. A removed row's ref callback
  // deletes its own entry, so this never leaks stale state.
  const inputRefs = useRef(new Map<number, HTMLInputElement>());

  // One row DIV per CreateStepDraft key — exists purely so a failed
  // save can scroll the actually-failing row into view, the same way
  // inputRefs above lets a freshly-added row's input get focused.
  // Populated/cleaned up identically (ref callback add/delete by key).
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  // Set right before adding a row via the picker; consumed (and reset
  // to null) by the effect below on the very next createSteps commit.
  // Left null after every other createSteps-changing action (remove,
  // param edit, reset), so those never trigger a focus.
  const pendingFocusKeyRef = useRef<number | null>(null);

  // Whether the row addTool is about to add will actually register a
  // primary input ref — driven by step-fields/registry.ts's own
  // `hasPrimaryInput` per type, not `preset.implemented`: an
  // implemented type can still have no input (e.g. Clockify, which
  // has nothing to configure). Read by the Add-tool dropdown's
  // onCloseAutoFocus below.
  const pendingFocusHasInputRef = useRef(false);

  // Save is async (window.api.createWorkspace/updateWorkspace is an IPC
  // round trip) — if the modal is closed (unmounted) before it
  // resolves, these setState calls must be no-ops, same guard and
  // reasoning as Detail.tsx's handleRestore.
  const isMountedRef = useIsMounted();

  const resetAppPathDetections = appPathDetections.reset;
  const resetProjectFilesDetection = projectFilesDetection.reset;
  const resetForm = useCallback(() => {
    nextKeyRef.current = 0;
    setName('');
    setCreateSteps(initialDrafts(nextKeyRef));
    setOpenKeys(new Set());
    setSaveError(null);
    setIsSaving(false);
    setPendingChange(null);
    setConfirmedCloses(new Set());
    resetAppPathDetections();
    resetProjectFilesDetection();
  }, [resetAppPathDetections, resetProjectFilesDetection]);

  function closeAndReset(): void {
    resetForm();
    onClose();
  }

  // Re-seeds the form every time the modal transitions to open — from
  // editingWorkspace's real saved name/steps in edit mode, or back to
  // the same 2-row defaults as before in create mode. Runs on `open`
  // (not just at mount) because, unlike the old create-only modal, this
  // instance now stays mounted across both create and edit uses.
  useEffect(() => {
    if (!open) return;
    if (editingWorkspace) {
      nextKeyRef.current = 0;
      setName(editingWorkspace.name);
      setCreateSteps(draftsFromWorkspace(editingWorkspace, nextKeyRef));
      setOpenKeys(new Set());
      setSaveError(null);
      resetAppPathDetections();
      resetProjectFilesDetection();
    } else {
      resetForm();
    }
  }, [open, editingWorkspace, resetForm, resetAppPathDetections, resetProjectFilesDetection]);

  /**
   * Adds a row for the picked preset and queues it to receive focus
   * (see the effect below) the moment its input, if any, exists in the
   * DOM. Replaces the old `createSteps.length %
   * CREATE_TOOL_PRESETS.length` round robin, whose cycling broke the
   * instant any row was removed (length changed underneath it) — this
   * just adds exactly the preset the user picked, every time,
   * duplicates included.
   */
  function addTool(preset: CreateToolPreset): void {
    const key = nextKeyRef.current++;
    pendingFocusKeyRef.current = key;
    pendingFocusHasInputRef.current = stepFieldsHasPrimaryInput(preset.type);
    setCreateSteps((steps) => [...steps, { key, preset, params: {} }]);
    // Auto-expand a freshly-added collapsible row — otherwise its
    // content (an input to focus, or e.g. spotify's Connect button)
    // would be hidden behind a collapsed row, which the user would have
    // no way to discover without already knowing to click the chevron.
    // Driven by collapsibility, not by whether there's an input to
    // focus — those are independent (see step-fields/registry.ts).
    if (stepFieldsIsCollapsible(preset.type)) {
      setOpenKeys((current) => new Set(current).add(key));
    }
  }

  // Focuses a just-added row's input, if it has one. Runs after every
  // createSteps change, but pendingFocusKeyRef is only non-null right
  // after addTool set it, so remove/param-edit/reset renders are
  // no-ops here. A non-vscode pick leaves inputRefs without an entry
  // for that key, so `.get(key)` is undefined and `?.focus()` does
  // nothing — no dangling state, no special-casing by type needed at
  // this layer.
  useEffect(() => {
    const key = pendingFocusKeyRef.current;
    if (key === null) {
      return;
    }
    pendingFocusKeyRef.current = null;
    inputRefs.current.get(key)?.focus();
  }, [createSteps]);

  /**
   * A row's ✕. Removing a saved step whose app this workspace opened and
   * nothing else uses would close that app, so that's confirmed first
   * (StepChangeConfirm) — same rule as the Detail view's inline remove.
   * Checked against the SAVED workspace minus this step, so other
   * unsaved edits don't show up in this question. The close itself only
   * happens on Save; cancelling the form undoes everything.
   */
  async function requestRemoveTool(key: number): Promise<void> {
    const draft = createSteps.find((s) => s.key === key);
    if (!editingWorkspace || draft?.id === undefined) {
      removeTool(key);
      return;
    }
    const stepId = draft.id;
    let closes: string[];
    try {
      closes = await window.api.previewStepsChange(
        editingWorkspace.id,
        editingWorkspace.tools
          .filter((t) => t.id !== stepId)
          .map((t) => ({ id: t.id, type: t.type, params: t.params })),
      );
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
      return;
    }
    if (!isMountedRef.current) return;
    if (closes.length === 0) {
      removeTool(key);
      return;
    }
    setPendingChange({ action: 'remove', key, closes });
  }

  function removeTool(key: number): void {
    setCreateSteps((steps) => steps.filter((s) => s.key !== key));
    setOpenKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function toggleOpen(key: number): void {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  /**
   * Merges new param values into one draft row's params by key.
   * Shaped as a partial merge (not "replace the whole params object")
   * so a tool with more than one field (e.g. Chrome's profile *and*
   * urls) can update one field at a time the same way VS Code's path
   * input always has — the original controlled per-tool-param input in
   * this codebase, and the template every StepParamsFields case
   * follows.
   */
  function updateStepParams(key: number, params: Record<string, unknown>): void {
    setCreateSteps((steps) =>
      steps.map((s) => (s.key === key ? { ...s, params: { ...s.params, ...params } } : s)),
    );
  }

  const steps: WorkspaceStepInput[] = useMemo(
    () =>
      createSteps.map((draft) => ({
        ...(draft.id === undefined ? {} : { id: draft.id }),
        type: draft.preset.type,
        params: draft.params,
      })),
    [createSteps],
  );

  // Create mode only — editing a workspace into matching another
  // existing one is a real but much rarer case, and excludeId would
  // just hide it from matching ITSELF anyway; not worth the extra
  // complexity here for a scenario this form's edit path doesn't
  // actually produce (see SaveCurrentWorkspaceModal's own identical
  // check for the primary motivating case — repeat-saving the detected
  // current state with no changes in between).
  const duplicateOf = useMemo(
    () =>
      !editingWorkspace && name.trim()
        ? findDuplicateWorkspace({ name, steps }, workspaces)
        : undefined,
    [editingWorkspace, name, steps, workspaces],
  );

  /**
   * Shared by handleSave/handleUpdateExisting's failure path: stores the
   * banner text, and — when the backend named which step failed —
   * expands that row (it may currently be collapsed) and scrolls it
   * into view, so "which of my N steps is broken" never relies on the
   * user reading a flat type name out of the bottom banner and hunting
   * for it. `stepIndex` is translated to the step's stable
   * CreateStepDraft key immediately, against `createSteps` as it stands
   * for *this* save attempt — see saveError's own doc comment for why
   * the index itself is never stored.
   */
  function applySaveFailure(result: {
    error: string;
    code: string;
    stepIndex?: number;
    fieldErrors?: Record<string, string>;
  }): void {
    const stepKey =
      typeof result.stepIndex === 'number' ? createSteps[result.stepIndex]?.key : undefined;
    setSaveError({
      message: result.error,
      code: result.code,
      ...(stepKey !== undefined ? { stepKey } : {}),
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    });
    if (stepKey !== undefined) {
      setOpenKeys((current) => new Set(current).add(stepKey));
      // Deferred a frame so the row has actually expanded (and the
      // fields block mounted) before scrolling to it.
      requestAnimationFrame(() => {
        rowRefs.current.get(stepKey)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  /**
   * Save. When editing, a change that would close something this
   * workspace opened and nothing else uses (a changed terminal, a
   * removed app) asks first — unless every such close was already
   * confirmed via a row's ✕.
   */
  async function handleSave(): Promise<void> {
    if (!editingWorkspace) {
      await save(false);
      return;
    }
    setSaveError(null);
    let closes: string[];
    try {
      closes = await window.api.previewStepsChange(editingWorkspace.id, steps);
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
      return;
    }
    if (!isMountedRef.current) return;
    const unconfirmed = closes.filter((label) => !confirmedCloses.has(label));
    if (unconfirmed.length > 0) {
      setPendingChange({ action: 'save', closes: unconfirmed });
      return;
    }
    await save(closes.length > 0);
  }

  /** Saves the draft; when editing, then applies it (`close`: what was confirmed). */
  async function save(close: boolean): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      const result: CreateWorkspaceResult | UpdateWorkspaceResult = editingWorkspace
        ? await window.api.updateWorkspace({ id: editingWorkspace.id, name, steps })
        : await window.api.createWorkspace({ name, steps });
      if (!isMountedRef.current) {
        return;
      }
      if (!result.success) {
        applySaveFailure(result);
        return;
      }
      if (editingWorkspace) {
        await applySavedChange(editingWorkspace.id, close);
      }
      onSaved(result.config);
      closeAndReset();
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  /**
   * After a successful save: what removed or changed steps held is
   * released (closed with `close` — confirmed), and changed steps run
   * again with their new settings (orchestrator.ts's applyStepsChange).
   * The workspace is already saved by then, so a failure here is logged
   * rather than shown as a save failure.
   */
  async function applySavedChange(workspaceId: string, close: boolean): Promise<void> {
    try {
      await window.api.applyStepsChange(workspaceId, close);
    } catch (err) {
      console.error(
        `Couldn't apply the saved changes: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The duplicate banner's offered alternative — see
   * SaveCurrentWorkspaceModal's identical handleUpdateExisting for the
   * full reasoning. Only reachable in create mode (duplicateOf is
   * always undefined in edit mode). */
  async function handleUpdateExisting(): Promise<void> {
    if (!duplicateOf) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // Keeps the duplicate's step ids — see withStepIdsOf.
      const result = await window.api.updateWorkspace({
        id: duplicateOf.id,
        name,
        steps: withStepIdsOf(steps, duplicateOf.tools),
      });
      if (!isMountedRef.current) return;
      if (!result.success) {
        applySaveFailure(result);
        return;
      }
      onSaved(result.config);
      closeAndReset();
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError({
          message: err instanceof Error ? err.message : String(err),
          code: ERROR_CODES.SYSTEM_UNEXPECTED.code,
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Blocks every close path (X button, footer Cancel, Escape,
        // overlay click — onOpenChange is the one funnel all of them
        // go through) while a save is in flight. Without this, closing
        // mid-save and immediately reopening the modal for a different
        // workspace let the stale save's closure resolve afterward and
        // call onSaved/closeAndReset with the FIRST workspace's data,
        // silently clobbering the second edit session already in
        // progress.
        if (!next && !isSaving) {
          closeAndReset();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-190"
        onOpenAutoFocus={(e) => {
          // Radix's Dialog.Content auto-focuses the first focusable
          // element on mount by default — here that's the close (X)
          // button, not the name field, which meant a keystroke typed
          // immediately after opening (before an explicit click into
          // the name field) could hit the close button instead of the
          // input. Unlike the Add-tool DropdownMenuContent below,
          // Dialog.Content's public type DOES expose onOpenAutoFocus,
          // so the real Radix API is used directly here rather than the
          // rAF-deferred-focus workaround that dropdown needed.
          e.preventDefault();
          nameInputRef.current?.focus();
        }}
        {...(isSaving
          ? {}
          : {
              onEnterKey: () => {
                void handleSave();
              },
            })}
      >
        <DialogHeader>
          <DialogTitle>{editingWorkspace ? 'Edit workspace' : 'New workspace'}</DialogTitle>
          <DialogClose
            disabled={isSaving}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="mb-1.5 text-xs font-medium text-text-muted">Workspace name</p>
          <div className="mb-4.5">
            <input
              ref={nameInputRef}
              className="h-8.5 w-full rounded-sm border border-border-strong bg-bg-elevated px-2.75 text-[13px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
              type="text"
              placeholder="e.g. Client C — Backend"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            {duplicateOf && (
              // Same informational, never-blocking pattern as
              // SaveCurrentWorkspaceModal's identical banner — only
              // fires on a real, exact duplicate (same name AND same
              // steps), never a loose name-only match.
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

          <p className="mb-1.5 text-xs font-medium text-text-muted">Tools</p>
          <div className="mb-3.5 flex flex-col">
            {createSteps.map((draft, index) => {
              const { key, preset, params } = draft;
              const isLast = index === createSteps.length - 1;
              const collapsible = stepFieldsIsCollapsible(preset.type);
              const isOpen = collapsible && openKeys.has(key);
              const hasFields = getStepFieldsComponent(preset.type) !== undefined;
              // A non-collapsible type (today: Clockify) has nothing a
              // fields block could ever show — its one-line explanation
              // lives in the header subtitle instead (configHint, e.g.
              // "Nothing to configure"), same line as the name, not a
              // separate block below.
              const subtitle = collapsible ? stepRowSummary(preset.type, params) : preset.config;
              // The generic 'app' type isn't one fixed thing like every
              // other preset — showing the literal preset name ("App")
              // would be useless with more than one app step in the
              // same workspace (which app?). Falls back to the static
              // preset name until a real app is actually chosen.
              const rowName =
                preset.type === 'app' && typeof params['path'] === 'string' && params['path']
                  ? appDisplayName(params['path'])
                  : preset.name;
              // Only the three "project directory"-shaped step types
              // ever get a suggestion — see project-path-suggestion.ts's
              // own doc comment for why this isn't a generic mechanism.
              const projectPathSuggestion = PROJECT_PATH_STEP_TYPES.has(preset.type)
                ? getProjectPathSuggestion(
                    createSteps.map((d) => ({ key: d.key, type: d.preset.type, params: d.params })),
                    key,
                  )
                : undefined;
              const directory = typeof params['directory'] === 'string' ? params['directory'] : '';
              return (
                <div
                  className="flex gap-2.5"
                  key={key}
                  ref={(el) => {
                    if (el) {
                      rowRefs.current.set(key, el);
                    } else {
                      rowRefs.current.delete(key);
                    }
                  }}
                >
                  <div className="flex shrink-0 flex-col items-center pt-0.5">
                    <div className="group/index relative flex h-5.5 w-5.5 shrink-0 cursor-grab items-center justify-center rounded-full border border-border-strong bg-bg-elevated">
                      <span className="text-[10.5px] font-semibold text-text-faint transition-opacity group-hover/index:opacity-0">
                        {index + 1}
                      </span>
                      <span className="absolute inset-0 flex items-center justify-center text-text-muted opacity-0 transition-opacity group-hover/index:opacity-100">
                        <Icon name="dragHandle" size={13} />
                      </span>
                    </div>
                    {!isLast && <div className="mt-0.5 w-px flex-1 bg-border" />}
                  </div>
                  <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-3')}>
                    <div
                      className={cn(
                        'flex min-h-6 items-center gap-2.25',
                        collapsible && 'cursor-pointer',
                      )}
                      onClick={
                        collapsible
                          ? () => {
                              toggleOpen(key);
                            }
                          : undefined
                      }
                    >
                      <ToolBadge
                        type={preset.type}
                        icon={preset.icon}
                        color={preset.color}
                        size={13}
                        chipClassName="h-6 w-6 text-[13px]"
                        params={params}
                      />
                      <span className="text-[12.5px] font-medium text-text">{rowName}</span>
                      {subtitle && (
                        <>
                          <span className="text-[11.5px] text-text-faint">·</span>
                          <span className="min-w-0 truncate text-[11.5px] text-text-faint">
                            {subtitle}
                          </span>
                        </>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        {collapsible && (
                          <span
                            className={cn(
                              'flex h-5.5 w-5.5 items-center justify-center text-text-faint transition-transform duration-140',
                              isOpen && 'rotate-90',
                            )}
                          >
                            <Icon name="chevronRight" size={13} />
                          </span>
                        )}
                        <span
                          className="flex h-5.5 w-5.5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-text-faint hover:bg-bg-active hover:text-text"
                          onClick={(e) => {
                            e.stopPropagation();
                            void requestRemoveTool(key);
                          }}
                        >
                          <Icon name="x" size={13} />
                        </span>
                      </span>
                    </div>

                    {/* isOpen is already always false for a non-collapsible
                        type (see its derivation above), so this naturally
                        never shows a fields block for one — its message
                        lives in the header subtitle above instead. */}
                    {hasFields && isOpen && (
                      <div className="mt-2 ml-8.5">
                        <StepParamsFields
                          preset={preset}
                          params={params}
                          onChange={(next) => {
                            updateStepParams(key, next);
                          }}
                          registerPrimaryInputRef={(el) => {
                            if (el) {
                              inputRefs.current.set(key, el);
                            } else {
                              inputRefs.current.delete(key);
                            }
                          }}
                          recentFolders={recentFolders.filter((p) => p !== params['path'])}
                          recentCommands={recentCommands}
                          spotify={spotify}
                          {...(isToolAppKey(preset.type)
                            ? { appPathDetection: appPathDetections.forTool(preset.type) }
                            : {})}
                          {...(saveError?.stepKey === key && saveError.fieldErrors
                            ? { fieldErrors: saveError.fieldErrors }
                            : {})}
                          {...(projectPathSuggestion ? { projectPathSuggestion } : {})}
                          {...(preset.type === 'docker'
                            ? {
                                projectFilesDetection:
                                  projectFilesDetection.forDirectory(directory),
                              }
                            : {})}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DropdownMenu
            open={isAddToolOpen}
            onOpenChange={(open) => {
              setIsAddToolOpen(open);
              if (!open) {
                // Fresh next time it opens — stale leftover text would
                // otherwise silently hide tools on the next open.
                setToolSearchQuery('');
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-xs text-text-faint hover:border-text-faint hover:text-text-muted"
                type="button"
              >
                <Icon name="plus" size={12} />
                Add tool
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="flex max-h-72 w-72 flex-col overflow-hidden p-0"
              align="start"
              onKeyDown={(e) => {
                // While this menu is open, the app's own configured
                // "focus search" shortcut (e.g. ⌘K — whatever the user
                // has it bound to, read fresh, never hardcoded) should
                // refocus THIS search box, not bubble up to the global
                // window-level listener (lib/useGlobalShortcuts.ts)
                // and jump focus to the sidebar's workspace search
                // instead. stopPropagation() on the synthetic event
                // also stops the underlying native event, which is
                // what actually keeps it from ever reaching that
                // window listener — not a cross-component flag/ref,
                // just the DOM's own propagation model.
                const effective = getEffectiveShortcuts(SHORTCUTS, getStoredOverrides());
                const searchShortcut = effective.find((s) => s.id === 'search.focus');
                if (searchShortcut && matchesCombo(e.nativeEvent, searchShortcut.combo, isMac)) {
                  e.preventDefault();
                  e.stopPropagation();
                  toolSearchInputRef.current?.focus();
                  toolSearchInputRef.current?.select();
                }
              }}
              onCloseAutoFocus={(e) => {
                // Without this, Radix's own FocusScope unmount handler
                // snaps focus back to this trigger button on close
                // (verified in @radix-ui/react-focus-scope's source:
                // it refocuses the previously-focused element unless
                // this is prevented) — which would fight the
                // pendingFocusKeyRef effect's own focus() call.
                //
                // Only suppressed when the just-picked type actually
                // has a primary input to hand focus to instead (types
                // whose fields component actually registers an input —
                // see step-fields/registry.ts's hasPrimaryInput). For a
                // type with no input at all — an unimplemented type
                // (Docker/Terminal/Slack, selectable but StepParamsFields
                // renders no input for them) or an implemented-but-
                // fieldless one (Clockify) — there's nothing for the
                // pendingFocusKeyRef effect to focus, so letting Radix's
                // default refocus run keeps focus on a real, visible
                // element instead of it silently falling through to
                // <body> and breaking the next Tab press.
                if (pendingFocusHasInputRef.current) {
                  e.preventDefault();
                }
              }}
            >
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                <Icon name="search" size={12} className="shrink-0 text-text-faint" />
                <input
                  ref={toolSearchInputRef}
                  type="text"
                  value={toolSearchQuery}
                  onChange={(e) => {
                    setToolSearchQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    // Let navigation keys bubble to Radix's own
                    // roving-focus handling so ArrowDown/ArrowUp move
                    // from "typing" into "picking an item" — stop
                    // everything else (ordinary letters) from reaching
                    // it, so typing a tool's name doesn't also trigger
                    // Radix's built-in single-character typeahead jump.
                    //
                    // Enter is deliberately NOT let through (unlike the
                    // original version of this list): confirmed by
                    // reading Radix's own Menu source that it only ever
                    // preventDefaults Enter once an actual MenuItem has
                    // focus, never while this plain search input does —
                    // so letting it bubble here did nothing useful for
                    // Radix, while it DOES reach Dialog.tsx's new
                    // Enter-to-confirm handling and prematurely saves
                    // the whole workspace form mid-search.
                    if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(e.key)) {
                      e.stopPropagation();
                    }
                  }}
                  placeholder="Search tools…"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text placeholder:text-text-faint focus:outline-none"
                />
              </div>
              <DropdownMenuSeparator className="mx-0 my-0" />
              <div className="flex-1 overflow-y-auto p-1">
                {filteredToolPresets.length === 0 ? (
                  <p className="px-2.5 py-2 text-[12px] text-text-faint">
                    No tools match &ldquo;{toolSearchQuery}&rdquo;
                  </p>
                ) : (
                  filteredToolPresets.map((preset) => (
                    <ToolPickerItem
                      key={preset.type}
                      preset={preset}
                      onSelect={() => {
                        addTool(preset);
                      }}
                    />
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {saveError && (
            <div className="mt-3.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
              <Icon name="x" size={13} className="text-danger" />
              <ErrorCode
                message={saveError.message}
                code={saveError.code}
                onLearnMore={onShowErrorCode}
                // The broken row (if any) is already auto-expanded with
                // this exact message shown inline under the offending
                // field — see WORKSPACE_INVALID's own doc comment for
                // why repeating it here too is pure duplication.
                hideTechnicalDetail={
                  saveError.fieldErrors !== undefined &&
                  Object.keys(saveError.fieldErrors).length > 0
                }
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose
            disabled={isSaving}
            className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            Cancel
          </DialogClose>
          <button
            className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
            type="button"
            disabled={isSaving}
            onClick={() => {
              void handleSave();
            }}
          >
            {isSaving
              ? 'Saving…'
              : editingWorkspace
                ? 'Save changes'
                : duplicateOf
                  ? 'Save as new anyway'
                  : 'Save workspace'}
          </button>
        </DialogFooter>
        <StepChangeConfirm
          pending={pendingChange}
          onCancel={() => {
            setPendingChange(null);
          }}
          onConfirm={() => {
            const change = pendingChange;
            setPendingChange(null);
            if (!change) return;
            setConfirmedCloses((current) => new Set([...current, ...change.closes]));
            if (change.action === 'remove') removeTool(change.key);
            else void save(true);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
