import { useState } from 'react';
import { Icon } from '../icons';
import { CREATE_TOOL_PRESETS, type CreateToolPreset } from '../constants';
import { cn } from '../lib/utils';
import { toolBadgeClasses } from '../lib/tool-colors';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps): JSX.Element {
  const [createSteps, setCreateSteps] = useState<CreateToolPreset[]>([
    CREATE_TOOL_PRESETS[0]!,
    CREATE_TOOL_PRESETS[1]!,
  ]);

  function addTool(): void {
    const next = CREATE_TOOL_PRESETS[createSteps.length % CREATE_TOOL_PRESETS.length]!;
    setCreateSteps((steps) => [...steps, next]);
  }

  function removeTool(index: number): void {
    setCreateSteps((steps) => steps.filter((_, i) => i !== index));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="mb-1.5 text-xs font-medium text-text-muted">Workspace name</p>
          <input
            className="mb-4.5 h-8.5 w-full rounded-sm border border-border-strong bg-bg-elevated px-2.75 text-[13px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
            type="text"
            placeholder="e.g. Client C — Backend"
          />

          <p className="mb-1.5 text-xs font-medium text-text-muted">Tools · runs in order added</p>
          <div className="mb-3.5 flex flex-col gap-2">
            {createSteps.map((s, i) => {
              return (
                <div
                  className="flex items-center gap-2.5 rounded-sm border border-border bg-bg-elevated px-2.5 py-2.25"
                  key={i}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-sm text-[13px]',
                      toolBadgeClasses(s.color),
                    )}
                  >
                    <Icon name={s.icon} size={13} />
                  </span>
                  <div>
                    <div className="text-[12.5px] font-medium text-text">{s.name}</div>
                    <div className="mt-px text-[11.5px] text-text-faint">{s.config}</div>
                  </div>
                  <span
                    className="ml-auto flex h-5.5 w-5.5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-text-faint hover:bg-bg-active hover:text-text"
                    onClick={() => {
                      removeTool(i);
                    }}
                  >
                    <Icon name="x" size={13} />
                  </span>
                </div>
              );
            })}
          </div>

          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-xs text-text-faint hover:border-text-faint hover:text-text-muted"
            type="button"
            onClick={addTool}
          >
            <Icon name="plus" size={12} />
            Add tool
          </button>
        </div>

        <DialogFooter>
          <DialogClose className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text">
            Cancel
          </DialogClose>
          <button
            className="h-8 rounded-md bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover"
            type="button"
          >
            Save workspace
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
