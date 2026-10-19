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
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border px-3 py-4">
      <div className="mb-3.5 flex items-center gap-2.25 px-1.5 pt-0.5 pb-1">
        <span className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-[14px] text-accent">
          <Icon name="layers" />
        </span>
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-text">
          Workspace Launcher
        </span>
        <span className="ml-auto rounded-[5px] border border-border-strong px-1.25 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-text-faint uppercase">
          Beta
        </span>
      </div>

      <button
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border-strong bg-transparent text-[12.5px] font-medium text-text-muted transition-colors duration-120 hover:bg-bg-hover hover:text-text"
        type="button"
        onClick={onNewWorkspace}
      >
        <Icon name="plus" />
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
              'group flex cursor-pointer items-start gap-2.25 rounded-md border border-transparent px-2.5 py-2.25',
              ws.id === activeId ? 'border-accent-border bg-accent-soft' : 'hover:bg-bg-hover',
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
            <span className={cn('mt-1.25 h-2 w-2 shrink-0 rounded-full', tagDotClasses(ws.tag))} />
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap text-text">
                {ws.name}
              </div>
              <div className="mt-0.5 overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-text-faint">
                {ws.subtitle}
              </div>
            </div>
            {ws.active && (
              // Computed server-side (intent + liveness — see
              // WCs/WC__workspace-activity.md), never a locally-set
              // flag. Always absent on non-macOS (v1 scope). Wording
              // deliberately says "at least one," not "all" — VS
              // Code's liveness check is app-level, not per-window, so
              // this can be true with only some of this workspace's
              // apps actually still open.
              <span
                className="mt-0.5 shrink-0 rounded-[5px] border border-success px-1.25 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-success uppercase"
                title="At least one of this workspace's apps is still open"
              >
                Active
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${ws.name}`}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-text-faint opacity-0 group-hover:opacity-100 hover:bg-bg-active hover:text-text data-[state=open]:bg-bg-active data-[state=open]:text-text data-[state=open]:opacity-100"
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
