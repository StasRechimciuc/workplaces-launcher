import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateWorkspaceResult,
  UpdateWorkspaceResult,
  WorkspaceConfig,
  WorkspaceStep,
} from '@workspace-launcher/shared';
import type { WorkspaceDisplay, WorkspaceToolStepDisplay } from '../../../preload';
import { Icon } from '../icons';
import { CREATE_TOOL_PRESETS, type CreateToolPreset } from '../constants';
import { cn } from '../lib/utils';
import { toolBadgeClasses } from '../lib/tool-colors';
import { useIsMounted } from '../lib/useIsMounted';
import { getStepFieldsComponent, stepFieldsHasPrimaryInput } from './step-fields/registry';
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
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface WorkspaceFormModalProps {
  open: boolean;
  /** null = create mode; a workspace = editing that one. */
  editingWorkspace: WorkspaceDisplay | null;
  onClose: () => void;
  /** Fires on a successful save in either mode. */
  onSaved: (config: WorkspaceConfig) => void;
}

/**
 * One row in the "Tools · runs in order added" list — a preset (icon/
 * color/name/type from CREATE_TOOL_PRESETS) plus whatever params the
 * user has entered for that specific row. `key` is a stable identity
 * independent of the row's position in the array: removing an earlier
 * row must not reattach a later row's already-typed params to the
 * wrong preset, which a plain array index would risk the moment any
 * row before it is removed.
 */
interface CreateStepDraft {
  key: number;
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
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[13px]',
            toolBadgeClasses(preset.color),
          )}
        >
          <Icon name={preset.icon} size={13} />
        </span>
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
}: StepParamsFieldsProps): JSX.Element | null {
  const Fields = getStepFieldsComponent(preset.type);
  if (!Fields) {
    return null;
  }
  return (
    <Fields params={params} onChange={onChange} registerPrimaryInputRef={registerPrimaryInputRef} />
  );
}

export function WorkspaceFormModal({
  open,
  editingWorkspace,
  onClose,
  onSaved,
}: WorkspaceFormModalProps): JSX.Element {
  const nextKeyRef = useRef(0);
  const [name, setName] = useState('');
  const [createSteps, setCreateSteps] = useState<CreateStepDraft[]>(() =>
    initialDrafts(nextKeyRef),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Populated for whichever type's row renders a primary field via
  // StepParamsFields' `registerPrimaryInputRef` prop — vscode's path,
  // chrome's profile, spotify's playlist. A removed row's ref callback
  // deletes its own entry, so this never leaks stale state.
  const inputRefs = useRef(new Map<number, HTMLInputElement>());

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

  const resetForm = useCallback(() => {
    nextKeyRef.current = 0;
    setName('');
    setCreateSteps(initialDrafts(nextKeyRef));
    setSaveError(null);
    setIsSaving(false);
  }, []);

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
      setSaveError(null);
    } else {
      resetForm();
    }
  }, [open, editingWorkspace, resetForm]);

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

  function removeTool(key: number): void {
    setCreateSteps((steps) => steps.filter((s) => s.key !== key));
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

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    try {
      const steps: WorkspaceStep[] = createSteps.map((draft) => ({
        type: draft.preset.type,
        params: draft.params,
      }));
      const result: CreateWorkspaceResult | UpdateWorkspaceResult = editingWorkspace
        ? await window.api.updateWorkspace({ id: editingWorkspace.id, name, steps })
        : await window.api.createWorkspace({ name, steps });
      if (!isMountedRef.current) {
        return;
      }
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      onSaved(result.config);
      closeAndReset();
    } catch (err) {
      if (isMountedRef.current) {
        setSaveError(err instanceof Error ? err.message : String(err));
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
      <DialogContent showCloseButton={false}>
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
          <input
            className="mb-4.5 h-8.5 w-full rounded-sm border border-border-strong bg-bg-elevated px-2.75 text-[13px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
            type="text"
            placeholder="e.g. Client C — Backend"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />

          <p className="mb-1.5 text-xs font-medium text-text-muted">Tools · runs in order added</p>
          <div className="mb-3.5 flex flex-col gap-2">
            {createSteps.map((draft) => {
              const { key, preset, params } = draft;
              return (
                <div
                  className="flex flex-col gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2.25"
                  key={key}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-sm text-[13px]',
                        toolBadgeClasses(preset.color),
                      )}
                    >
                      <Icon name={preset.icon} size={13} />
                    </span>
                    <div>
                      <div className="text-[12.5px] font-medium text-text">{preset.name}</div>
                      <div className="mt-px text-[11.5px] text-text-faint">{preset.config}</div>
                    </div>
                    <span
                      className="ml-auto flex h-5.5 w-5.5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-text-faint hover:bg-bg-active hover:text-text"
                      onClick={() => {
                        removeTool(key);
                      }}
                    >
                      <Icon name="x" size={13} />
                    </span>
                  </div>

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
                  />
                </div>
              );
            })}
          </div>

          <DropdownMenu>
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
              className="w-72"
              align="start"
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
              {CREATE_TOOL_PRESETS.map((preset) => (
                <ToolPickerItem
                  key={preset.type}
                  preset={preset}
                  onSelect={() => {
                    addTool(preset);
                  }}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {saveError && (
            <div className="mt-3.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
              <Icon name="x" size={13} className="text-danger" />
              <span>{saveError}</span>
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
            {isSaving ? 'Saving…' : editingWorkspace ? 'Save changes' : 'Save workspace'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
