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
}

export function Sidebar({
  workspaces,
  activeId,
  onSelect,
  onNewWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
}: SidebarProps): JSX.Element {
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
        {workspaces.map((ws) => (
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
              <div
                className={cn(
                  'overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap',
                  ws.id === activeId ? 'text-white' : 'text-text',
                )}
              >
                {ws.name}
              </div>
              <div className="mt-0.5 overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-text-faint">
                {ws.subtitle}
              </div>
            </div>
            {ws.readOnly ? (
              <span className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
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
            )}
          </div>
        ))}
      </div>

      <div className="mt-1.5 shrink-0 border-t border-border pt-2.5">
        <button
          className="flex w-full items-center gap-2.25 rounded-md px-2.5 py-2 text-left text-[12.5px] text-text-muted hover:bg-bg-hover hover:text-text"
          type="button"
        >
          <Icon name="settings" size={15} />
          Settings
        </button>
      </div>
    </aside>
  );
}
