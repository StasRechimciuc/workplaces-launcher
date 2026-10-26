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
  onSaveCurrentWorkspace: () => void;
  onEditWorkspace: (workspace: WorkspaceDisplay) => void;
  onDeleteWorkspace: (workspace: WorkspaceDisplay) => void;
  onOpenSettings: () => void;
  /** Only used to pick the right empty-state copy below — App.tsx has
   * already filtered `workspaces` by this before passing it down. */
  searchQuery: string;
  /** Each workspace's last Restore/Switch outcome this session, keyed
   * by id — a workspace absent here (never restored this session, or
   * restored with nothing to report either way) gets no status badge
   * at all, same "nothing to show" convention as TimelineStep's own
   * per-step statusBadge. Distinct from `ws.active` (the existing dot
   * below) — that's "is it running right now," live-checked and never
   * stale; this is "did its last restore succeed," which can disagree
   * with `active` (e.g. active because some steps opened, but one
   * step's command actually failed). */
  restoreOutcomeById: Record<string, 'success' | 'partial' | 'failed'>;
}

export function Sidebar({
  workspaces,
  activeId,
  onSelect,
  onNewWorkspace,
  onSaveCurrentWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onOpenSettings,
  searchQuery,
  restoreOutcomeById,
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

      {
        // "New workspace" and "Save current workspace" used to be two
        // separate, always-visible buttons — both really just two
        // different starting points for the same action ("make me a
        // new workspace"), not two unrelated things. Now one split
        // button: blank is the one-click default (what most people
        // reach for most often), detect-from-current-state moves into
        // its dropdown — still one click away, no longer competing for
        // its own permanent slot. Same consolidation as the Restore
        // split button in Detail.tsx, same direct founder feedback.
      }
      <div className="flex w-full items-stretch">
        <button
          className="flex h-10 flex-1 items-center justify-center gap-1.75 rounded-l-md border border-border-strong bg-bg-elevated text-[13px] font-semibold text-text transition-[background-color,border-color] duration-150 hover:bg-bg-hover"
          type="button"
          onClick={onNewWorkspace}
        >
          <Icon name="plus" size={14} />
          New workspace
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More ways to create a workspace"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-r-md border border-l-0 border-border-strong bg-bg-elevated text-text-muted transition-[background-color,border-color] duration-150 hover:bg-bg-hover hover:text-text data-[state=open]:bg-bg-hover data-[state=open]:text-text"
            >
              <Icon name="chevronRight" size={13} className="rotate-90" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-76">
            <DropdownMenuItem
              className="flex-col items-start gap-0.5 py-2"
              onSelect={onSaveCurrentWorkspace}
            >
              <span className="flex items-center gap-2">
                <Icon name="refresh" size={13} />
                Save current workspace
              </span>
              <span className="pl-5 text-[11px] leading-[1.4] text-text-faint">
                Detects what&rsquo;s currently open and builds a new workspace from it.
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="my-3 h-px shrink-0 bg-border" />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {searchQuery && workspaces.length > 0 && (
          <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.04em] text-text-faint uppercase">
            Search results
          </div>
        )}
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
              ws.id === activeId
                ? 'border-accent-border bg-bg-elevated'
                : [
                    'hover:bg-bg-hover',
                    // A running-but-not-selected row gets a faint green
                    // tint (the SAME color the pulsing dot already uses,
                    // not an unrelated neutral gray) — a real but subtle
                    // highlight, tied to what it actually means, not the
                    // flat brownish bg-bg-hover wash this used to reuse
                    // here (confirmed unattractive from a screenshot,
                    // then removed outright — only to leave active rows
                    // looking identical to any other, per direct
                    // follow-up feedback). Tailwind v4's `/opacity`
                    // modifier on a @theme-registered color needs no new
                    // CSS variable of its own.
                    ws.active && 'bg-success/8 hover:bg-success/14',
                  ],
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
            {restoreOutcomeById[ws.id] && (
              <span
                className={cn(
                  'mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full',
                  restoreOutcomeById[ws.id] === 'success' && 'bg-success',
                  restoreOutcomeById[ws.id] === 'failed' && 'bg-danger',
                  // Half-green/half-red — same convention RestoreResultsLegend
                  // already uses for a step's own "ran, then failed" state, not
                  // a new color invented just for this. A flat red dot here
                  // would read identically to a total wipeout, which is exactly
                  // what a user skimming several sidebar rows needs to tell
                  // apart without opening each one.
                  restoreOutcomeById[ws.id] === 'partial' &&
                    'bg-gradient-to-r from-success from-50% to-danger to-50%',
                )}
                title={
                  restoreOutcomeById[ws.id] === 'success'
                    ? 'Last restore: every step succeeded'
                    : restoreOutcomeById[ws.id] === 'partial'
                      ? 'Last restore: some steps succeeded, at least one failed'
                      : 'Last restore: every step failed'
                }
              >
                {restoreOutcomeById[ws.id] !== 'partial' && (
                  <Icon
                    name={restoreOutcomeById[ws.id] === 'success' ? 'check' : 'x'}
                    size={8}
                    className="text-bg"
                  />
                )}
              </span>
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
