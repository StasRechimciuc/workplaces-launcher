import type { ComponentProps } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Icon } from '../../icons';
import { cn } from '../../lib/utils';

/**
 * shadcn/ui's Dialog, wrapping Radix's Dialog primitive — themed to
 * this app's existing design tokens (bg/border/text from styles.css's
 * @theme block) rather than shadcn's default palette. Gains real
 * accessibility for free over the hand-rolled overlay it replaces:
 * focus trap, Escape-to-close, click-outside-to-close, and correct
 * ARIA roles/labelling, all handled by Radix.
 */

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>): JSX.Element {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>): JSX.Element {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>): JSX.Element {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>): JSX.Element {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>): JSX.Element {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-[rgba(4,4,6,0.55)]', className)}
      {...props}
    />
  );
}

/**
 * True when Enter pressed with this as the event target should trigger
 * a dialog's primary "confirm" action (onEnterKey below) — i.e. nothing
 * ELSE already has a well-defined native Enter behavior that would
 * otherwise conflict with it. A focused `<button>` already activates
 * itself on Enter (whichever one that is — Cancel, Close, or the
 * confirm button itself all do the right thing natively, with no help
 * needed here); a checkbox/radio's Enter is a no-op, not "submit"; a
 * `<textarea>` needs Enter to insert a newline, not submit. Everything
 * else (a plain text input, or no specific element focused at all —
 * Radix's own default content focus) falls through to "yes, confirm."
 *
 * This is an opt-OUT model, not opt-in: ANY plain text input anywhere
 * inside a dialog that wires onEnterKey submits on Enter by default,
 * including one nested several levels down inside a repeating row
 * (EditableStringList's own rows, terminal-fields.tsx's per-card
 * working-directory field) or a search box inside an open dropdown
 * (WorkspaceFormModal's Add-tool search) — both real, found-and-fixed
 * cases, not hypothetical. A new nested text input anywhere inside a
 * dialog that uses onEnterKey MUST explicitly stop Enter from
 * bubbling (`if (e.key === 'Enter') e.stopPropagation();` on that
 * input's own onKeyDown — see EditableStringList.tsx or
 * terminal-fields.tsx for the exact pattern) unless "Enter here
 * submits the whole dialog" is genuinely the intended behavior for
 * that specific field. An opt-IN model (e.g. a dedicated marker
 * attribute on just the one intended field) was considered instead and
 * rejected: Radix's Dialog auto-focuses the first tabbable element on
 * open (confirmed by reading @radix-ui/react-focus-scope's own
 * source), never the content wrapper itself whenever any button exists
 * inside — which every dialog using this prop has — so a
 * container-focused fallback could never actually fire for a dialog
 * like DeleteWorkspaceConfirm that has no text fields to mark at all.
 */
function isEnterConfirmTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return false;
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
    return false;
  }
  return true;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onEnterKey,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * Fires on a plain Enter press (no Shift) inside this dialog, for a
   * target with no conflicting native Enter behavior of its own (see
   * isEnterConfirmTarget) — the dialog's single "primary action" (Save/
   * Delete/Add/etc.), the Enter half of standard Esc-to-cancel/Enter-to-
   * confirm dialog behavior. Escape-to-close needs no equivalent prop:
   * Radix's Dialog already does that by default (this component's own
   * original doc comment above). Deliberately NOT wired into
   * lib/shortcuts.ts — this is baseline dialog behavior every dialog
   * gets for free, not a user-configurable/overridable shortcut.
   * Omitted entirely for a dialog with no single primary action
   * (Settings, a pure viewer).
   */
  onEnterKey?: () => void;
}): JSX.Element {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // True centering, not a fixed top offset — top-1/2 + -translate-y-1/2
          // (not the old top-16) so the dialog is actually vertically
          // centered in the window regardless of its height, instead of
          // pinned near the top.
          'fixed top-1/2 left-1/2 z-50 flex max-h-150 w-140 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-strong bg-bg shadow-[0_30px_70px_-15px_rgba(0,0,0,0.6)] focus:outline-none',
          className,
        )}
        {...props}
        onKeyDown={(e) => {
          // {...props} is spread BEFORE this, deliberately — a plain
          // prop placed after a spread always wins in JSX, so this is
          // what actually runs regardless of whether a future caller
          // ever passes its own onKeyDown too (chained below, not
          // silently dropped).
          props.onKeyDown?.(e);
          if (
            onEnterKey &&
            !e.defaultPrevented &&
            e.key === 'Enter' &&
            !e.shiftKey &&
            isEnterConfirmTarget(e.target)
          ) {
            // Prevented even though nothing here would otherwise act on
            // a bare Enter — keeps this consistent with every other
            // "Enter submits" control in the app rather than leaving it
            // to chance for whatever's actually focused.
            e.preventDefault();
            onEnterKey();
          }
        }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3.5 right-4 flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text focus:outline-none"
          >
            <Icon name="x" size={14} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'flex shrink-0 items-center justify-between border-b border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5',
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): JSX.Element {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 text-[14.5px] font-semibold text-text', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): JSX.Element {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs text-text-muted', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
