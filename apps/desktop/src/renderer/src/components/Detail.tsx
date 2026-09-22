import { useState } from 'react';
import type { StepResult } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { useIsMounted } from '../lib/useIsMounted';
import { TimelineStep } from './TimelineStep';
import { RestoreResults } from './RestoreResults';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface DetailProps {
  workspace: WorkspaceDisplay;
  onEditWorkspace: (workspace: WorkspaceDisplay) => void;
  onDeleteWorkspace: (workspace: WorkspaceDisplay) => void;
}

/**
 * Render key is the workspace id (see App.tsx) — React remounts this
 * component on workspace switch, which naturally resets expandedIndex
 * (and restore state) to their initial values, same as the mockup's
 * manual `expandedIndex = null` reset.
 */
export function Detail({
  workspace,
  onEditWorkspace,
  onDeleteWorkspace,
}: DetailProps): JSX.Element {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResults, setRestoreResults] = useState<StepResult[] | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Restoring a workspace (Docker/Tilt in particular) can take seconds.
  // If the user switches to a different workspace before it resolves,
  // App.tsx's key={workspace.id} unmounts this instance — without this
  // guard, the setState calls below would be no-ops on an unmounted
  // component and the restore's real result (which did happen — a
  // container may have actually started) would silently vanish instead
  // of surfacing anywhere.
  const isMountedRef = useIsMounted();

  async function handleRestore(): Promise<void> {
    setIsRestoring(true);
    setRestoreResults(null);
    setRestoreError(null);
    try {
      const results = await window.api.restoreWorkspace(workspace.id);
      if (isMountedRef.current) {
        setRestoreResults(results);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRestoreError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsRestoring(false);
      }
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-10 pt-7.5 pb-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="m-0 text-[21px] font-semibold tracking-[-0.01em] text-text">
            {workspace.name}
          </h1>
          <p className="mt-1.25 mb-0 text-[13px] text-text-muted">{workspace.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!workspace.readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${workspace.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-transparent text-[15px] text-text-muted hover:bg-bg-hover hover:text-text data-[state=open]:bg-bg-hover data-[state=open]:text-text"
                >
                  <Icon name="more" size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    onEditWorkspace(workspace);
                  }}
                >
                  <Icon name="pencil" size={13} />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="danger"
                  onSelect={() => {
                    onDeleteWorkspace(workspace);
                  }}
                >
                  <Icon name="trash" size={13} />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            className="flex h-8.5 items-center gap-1.75 rounded-md bg-accent px-3.75 text-[13px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_6px_16px_-6px_rgba(99,102,241,0.55)] transition-colors duration-120 hover:bg-accent-hover active:translate-y-px disabled:cursor-default disabled:opacity-60"
            type="button"
            disabled={isRestoring}
            onClick={() => {
              void handleRestore();
            }}
          >
            <Icon name="zap" size={14} />
            {isRestoring ? 'Restoring…' : 'Restore workspace'}
          </button>
        </div>
      </div>

      <div className="mt-4.5 flex flex-wrap gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted">
          <Icon name="check" size={12} className="text-text-faint" /> {workspace.tools.length} tools
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted">
          <Icon name="zap" size={12} className="text-text-faint" /> {workspace.restoreTime} to
          restore
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted">
          <Icon name="clock" size={12} className="text-text-faint" /> Last restored{' '}
          {workspace.lastRestored}
        </span>
      </div>

      <div className="mt-6.5 mb-5.5 h-px bg-border" />

      {restoreError && (
        <div className="mb-5.5 flex items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <span>{restoreError}</span>
        </div>
      )}
      {restoreResults && (
        <>
          <RestoreResults results={restoreResults} />
          <div className="mt-6.5 mb-5.5 h-px bg-border" />
        </>
      )}

      <p className="mb-4.5 text-[11px] font-semibold tracking-[0.07em] text-text-faint uppercase">
        Runs in order on restore
      </p>

      <div className="flex flex-col">
        {workspace.tools.map((tool, i) => (
          <TimelineStep
            key={i}
            tool={tool}
            index={i}
            isLast={i === workspace.tools.length - 1}
            isOpen={expandedIndex === i}
            onToggle={() => {
              setExpandedIndex((current) => (current === i ? null : i));
            }}
          />
        ))}
      </div>
    </main>
  );
}
