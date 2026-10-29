import { Icon } from '../icons';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface StepChangeConfirmProps {
  /**
   * null closes the dialog. `action`: removing one step, or saving an
   * edit (which may remove and change several); `closes`: what doing so
   * would close (orchestrator.ts's previewStepsChange).
   */
  pending: { action: 'remove' | 'save'; closes: string[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asked only when removing or changing steps would close something
 * right away: something this workspace opened that nothing else uses —
 * a changed terminal is closed and reopened with its new command.
 * Anything shared, already open before, or not running needs no
 * confirmation. Same dialog shape as DeleteWorkspaceConfirm.tsx; every
 * way of dismissing it is Cancel.
 */
export function StepChangeConfirm({
  pending,
  onCancel,
  onConfirm,
}: StepChangeConfirmProps): JSX.Element {
  const things = pending ? formatList(pending.closes) : '';
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="w-105" onEnterKey={onConfirm}>
        <DialogHeader>
          <DialogTitle>
            {pending?.action === 'remove' ? 'Remove this step?' : 'Save changes?'}
          </DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="p-5">
          <DialogDescription>
            {pending &&
              (pending.action === 'remove'
                ? `Removing this step will also close ${things}, which this workspace opened and nothing else is using.`
                : `Saving will close ${things}, which this workspace opened and nothing else is using. A changed step opens again with its new settings.`)}
          </DialogDescription>
        </div>

        <DialogFooter>
          <DialogClose className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text">
            Cancel
          </DialogClose>
          <button
            className="h-8 rounded-md bg-danger px-3.5 text-[12.5px] font-semibold text-white hover:opacity-90"
            type="button"
            onClick={onConfirm}
          >
            {pending?.action === 'remove' ? 'Remove' : 'Save'} and close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
