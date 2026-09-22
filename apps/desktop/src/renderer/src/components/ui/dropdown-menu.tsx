import type { ComponentProps, MouseEvent } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

/**
 * shadcn/ui-style wrapper around Radix's DropdownMenu primitive — the
 * second Radix-based UI primitive in this repo after ui/dialog.tsx,
 * following its exact conventions (data-slot, cn() merging, themed to
 * this app's tokens). Backs the sidebar row and Detail header "•••"
 * kebab menus (Edit / Delete).
 */

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>): JSX.Element {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(
  props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
): JSX.Element {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuPortal(
  props: ComponentProps<typeof DropdownMenuPrimitive.Portal>,
): JSX.Element {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  onClick,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): JSX.Element {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-40 overflow-hidden rounded-md border border-border-strong bg-bg-elevated p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] focus:outline-none',
          className,
        )}
        // Stops a click on any item inside this (portaled) menu from
        // continuing to bubble to whatever DOM ancestor this menu is
        // logically nested under in JSX (e.g. a clickable sidebar row).
        // React re-dispatches synthetic events through the component
        // tree, not the DOM tree, so a Radix Portal does NOT by itself
        // prevent that — this is the one place that guards every
        // current and future consumer of this menu, rather than
        // requiring each call site to remember it.
        onClick={(e: MouseEvent<HTMLDivElement>) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        {...props}
      />
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'danger';
}): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-[5px] px-2.5 py-1.75 text-[12.5px] text-text outline-none select-none',
        'hover:bg-bg-hover focus:bg-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        variant === 'danger' && 'text-danger hover:bg-danger/10 focus:bg-danger/10',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
