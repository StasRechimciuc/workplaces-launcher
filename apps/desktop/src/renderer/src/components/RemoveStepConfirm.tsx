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

interface RemoveStepConfirmProps {
  /** null closes the dialog; otherwise what removing the step closes. */
  pending: { closes: string[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asked only when removing a step would close something right away:
 * an app this workspace opened that nothing else is using (see
 * orchestrator.ts's previewWorkspaceStepRemoval). Removing a step
 * whose app is shared, was already open, or isn't running needs no
 * confirmation — nothing closes. Same dialog shape as
 * DeleteWorkspaceConfirm.tsx; every way of dismissing it is Cancel.
 */
export function RemoveStepConfirm({
  pending,
  onCancel,
  onConfirm,
}: RemoveStepConfirmProps): JSX.Element {
  const apps = pending ? formatList(pending.closes) : '';
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="w-105" onEnterKey={onConfirm}>
        <DialogHeader>
          <DialogTitle>Remove this step?</DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="p-5">
          <DialogDescription>
            {pending &&
              `Removing this step will also close ${apps}, which this workspace opened and nothing else is using.`}
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
            Remove and close {pending && pending.closes.length === 1 ? pending.closes[0] : 'them'}
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
