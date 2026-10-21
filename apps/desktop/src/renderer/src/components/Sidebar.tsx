import { useMemo } from 'react';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { tagDotClasses } from '../lib/tool-colors';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface SidebarProps {
  workspaces: WorkspaceDisplay[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewWorkspace: () => void;
  onEditWorkspace: (workspace: WorkspaceDisplay) => void;
  onDeleteWorkspace: (workspace: WorkspaceDisplay) => void;
  onOpenSettings: () => void;
  /** Only used to pick the right empty-state copy below — App.tsx has
   * already filtered `workspaces` by this before passing it down. */
  searchQuery: string;
}

export function Sidebar({
  workspaces,
  activeId,
  onSelect,
  onNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onOpenSettings,
  searchQuery,
}: SidebarProps): JSX.Element {
  // Active workspaces always float to the top — a stable partition, so
  // each group (active/inactive) keeps its own existing relative order
  // rather than being re-sorted by anything else.
  const orderedWorkspaces = useMemo(
    () => [...workspaces.filter((ws) => ws.active), ...workspaces.filter((ws) => !ws.active)],
    [workspaces],
  );

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-bg-sidebar px-3 py-4">
      <div className="mb-3.5 flex items-center gap-2.25 px-1.5 pt-0.5 pb-1">
        <span className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-[14px] text-accent">
          <Icon name="layers" />
        </span>
        <span className="font-serif text-[13.5px] font-semibold tracking-[-0.01em] text-text">
          Workspace Launcher
        </span>
        <span className="ml-auto rounded-[5px] border border-border-strong px-1.25 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-text-faint uppercase">
          Beta
        </span>
      </div>

      <button
        className="flex h-10 w-full items-center justify-center gap-1.75 rounded-md border border-border-strong bg-bg-elevated text-[13px] font-semibold text-text transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px hover:bg-bg-hover active:translate-y-0"
        type="button"
        onClick={onNewWorkspace}
      >
        <Icon name="plus" size={14} />
        New workspace
      </button>

      <div className="my-3 h-px shrink-0 bg-border" />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {workspaces.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <Icon name="search" size={18} className="text-text-faint" />
            {searchQuery ? (
              <p className="text-[12.5px] text-text-faint">
                No workspaces match &ldquo;{searchQuery}&rdquo;
              </p>
            ) : (
              <p className="text-[12.5px] text-text-faint">No workspaces yet</p>
            )}
          </div>
        )}
        {orderedWorkspaces.map((ws) => (
          <div
            key={ws.id}
            role="button"
            tabIndex={0}
            aria-current={ws.id === activeId ? 'true' : undefined}
            className={cn(
              'group flex cursor-pointer items-start gap-2.25 rounded-sm border border-transparent px-2.5 py-2.25 outline-none focus-visible:ring-2 focus-visible:ring-accent-border',
              ws.id === activeId ? 'border-accent-border bg-bg-elevated' : 'hover:bg-bg-hover',
              // A running workspace reads as subtly distinct even when
              // it isn't also the one currently being viewed — the
              // pulsing dot below is the primary "this is live" signal,
              // this is just a faint assist so the row doesn't look
              // identical to every other one at a glance.
              ws.active && ws.id !== activeId && 'bg-bg-hover',
            )}
            onClick={() => {
              onSelect(ws.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(ws.id);
              }
            }}
          >
            <span
              className={cn(
                'relative mt-1.25 flex shrink-0',
                ws.active ? 'h-2.5 w-2.5' : 'h-2 w-2',
              )}
            >
              {
                // Computed server-side (intent + liveness — see
                // WCs/WC__workspace-activity.md), never a locally-set
                // flag. Always absent on non-macOS (v1 scope). Solid
                // red while live, not the tag's own color — a live
                // indicator needs to read as unambiguous regardless of
                // whatever arbitrary tag color this workspace has.
                ws.active && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                )
              }
              <span
                className={cn(
                  'relative inline-flex h-full w-full rounded-full',
                  ws.active ? 'bg-success' : tagDotClasses(ws.tag),
                )}
              />
            </span>
            {ws.active ? (
              <div className="min-w-0 flex-1">
                <div className="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap text-text">
                  {ws.name}
                </div>
                <div className="mt-0.5 overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-text-faint">
                  {ws.subtitle}
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1 overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap text-text">
                  {ws.name}
                </div>
                <span className="shrink-0 text-[11.5px] text-text-faint">{ws.subtitle}</span>
              </div>
            )}
            <div className="relative mt-0.5 h-5 w-5 shrink-0">
              {!ws.active && (
                <span className="absolute inset-0 flex items-center justify-center text-text-faint transition-opacity duration-150 group-hover:opacity-0">
                  <Icon name="chevronRight" size={14} />
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${ws.name}`}
                    className="absolute inset-0 flex items-center justify-center rounded-[5px] text-text-faint opacity-0 group-hover:opacity-100 hover:bg-bg-active hover:text-text data-[state=open]:bg-bg-active data-[state=open]:text-text data-[state=open]:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      // Click and keydown are separate DOM events —
                      // stopping click propagation above doesn't stop a
                      // keydown (Enter/Space to open this menu) from
                      // also bubbling up to the row's own onKeyDown,
                      // which would fire onSelect(ws.id) as an unwanted
                      // side effect a keyboard user hitting Enter/Space
                      // on this button never intended, unlike a mouse
                      // click on the same button.
                      e.stopPropagation();
                    }}
                  >
                    <Icon name="more" size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      onEditWorkspace(ws);
                    }}
                  >
                    <Icon name="pencil" size={13} />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="danger"
                    onSelect={() => {
                      onDeleteWorkspace(ws);
                    }}
                  >
                    <Icon name="trash" size={13} />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1.5 shrink-0 border-t border-border pt-2.5">
        {/* Was a dead "Settings" button, then briefly repurposed into a
            direct theme toggle (this app's only preference at the
            time) — now a real Settings entry point, with the theme
            toggle moved inside SettingsModal.tsx as its first
            preference row, per that earlier button's own anticipation
            of this exact moment. */}
        <button
          className="flex items-center gap-2.25 rounded-md px-2.5 py-2 text-left text-[12.5px] text-text-muted hover:bg-bg-hover hover:text-text"
          type="button"
          onClick={onOpenSettings}
        >
          <Icon name="settings" size={15} />
        </button>
      </div>
    </aside>
  );
}
