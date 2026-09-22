import { useEffect, useState } from 'react';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { useIsMounted } from '../lib/useIsMounted';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface DeleteWorkspaceConfirmProps {
  /** null closes the dialog; a workspace opens it targeting that one. */
  workspace: WorkspaceDisplay | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

/**
 * A single, reusable confirm dialog for deleting one real workspace at
 * a time — built on the same ui/dialog.tsx primitives as
 * WorkspaceFormModal (see that file's own doc comment for why Radix
 * over a hand-rolled overlay). Not an AlertDialog: every way of
 * dismissing this dialog (Escape, overlay click, Cancel) has the same
 * safe no-op effect as Cancel, so the stricter dismissal-blocking Radix
 * reserves for AlertDialog buys nothing extra here.
 */
export function DeleteWorkspaceConfirm({
  workspace,
  onClose,
  onDeleted,
}: DeleteWorkspaceConfirmProps): JSX.Element {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useIsMounted();

  // A different (or no) workspace becoming the target must not carry
  // over a previous attempt's loading/error state — same reasoning as
  // WorkspaceFormModal's resetForm.
  useEffect(() => {
    setIsDeleting(false);
    setError(null);
  }, [workspace]);

  async function handleConfirm(): Promise<void> {
    if (!workspace) return;
    setIsDeleting(true);
    setError(null);
    try {
      const result = await window.api.deleteWorkspace(workspace.id);
      if (!isMountedRef.current) {
        return;
      }
      if (!result.success) {
        setError(result.error);
        return;
      }
      onDeleted(workspace.id);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsDeleting(false);
      }
    }
  }

  return (
    <Dialog
      open={workspace !== null}
      onOpenChange={(next) => {
        // Blocks every close path (X, Cancel, Escape, overlay click)
        // while a delete is in flight — same reasoning as
        // WorkspaceFormModal's save guard: without this, cancelling
        // mid-delete and opening this same shared dialog for a
        // different workspace lets the stale delete's `onDeleted(id)`
        // resolve afterward and unconditionally close whatever is
        // showing now.
        if (!next && !isDeleting) {
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={false} className="w-105">
        <DialogHeader>
          <DialogTitle>Delete workspace?</DialogTitle>
          <DialogClose
            disabled={isDeleting}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="p-5">
          <DialogDescription>
            {workspace &&
              `"${workspace.name}" and its saved configuration will be permanently deleted. This can't be undone.`}
          </DialogDescription>

          {error && (
            <div className="mt-3.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
              <Icon name="x" size={13} className="text-danger" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose
            disabled={isDeleting}
            className="h-8 rounded-md border border-border-strong px-3.25 text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text disabled:cursor-default disabled:opacity-60"
          >
            Cancel
          </DialogClose>
          <button
            className="h-8 rounded-md bg-danger px-3.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-default disabled:opacity-60"
            type="button"
            disabled={isDeleting}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete workspace'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
