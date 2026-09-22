import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceConfig } from '@workspace-launcher/shared';
import type { WorkspaceDisplay } from '../../preload';
import { Icon } from './icons';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { WorkspaceFormModal } from './components/WorkspaceFormModal';
import { DeleteWorkspaceConfirm } from './components/DeleteWorkspaceConfirm';
import { resolveActiveWorkspaceId } from './lib/workspace-selection';

// main/index.ts's windowFrameOptions puts the real OS window controls
// on different sides per platform: macOS's traffic lights top-left
// (trafficLightPosition), the Windows/Linux titleBarOverlay's
// minimize/maximize/close cluster top-right. This custom-drawn title
// bar must reserve space on whichever side is actually in play, or the
// real controls render on top of — not beside — this content.
const isDarwin = window.api.platform === 'darwin';

export function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceDisplay[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceDisplay | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceDisplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Fetches the merged real+mock workspace list (see
   * src/main/ipc/handlers.ts's listWorkspaces) and applies it to
   * state. Shared by the initial load, "a workspace was just created/
   * edited," and "a workspace was just deleted" — all need the same
   * behavior, kept in one place instead of near-duplicate blocks that
   * could drift.
   *
   * When `selectId` is omitted, keeps the current selection only if it
   * still exists in the freshly loaded list, falling back to the first
   * workspace otherwise — needed because delete can make the currently
   * active id disappear; previously an omitted selectId always kept
   * `current` verbatim even if it no longer existed, leaving Detail
   * unrendered with nothing selected.
   */
  const refreshWorkspaces = useCallback((selectId?: string): Promise<void> => {
    return window.api
      .listWorkspaces()
      .then((loaded) => {
        setWorkspaces(loaded);
        setActiveId((current) => resolveActiveWorkspaceId(loaded, selectId ?? current));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load workspaces: ${message}`);
        setLoadError(message);
      });
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeId);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-bg">
      <div
        className="flex h-13 shrink-0 items-center gap-4 border-b border-border bg-bg-elevated px-3.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Reserves the space macOS's real traffic lights render into
            — see trafficLightPosition in main/index.ts. Not needed on
            Windows/Linux, where the OS controls sit on the right
            instead (below). */}
        {isDarwin && <div className="w-13 shrink-0" />}

        <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-text-faint">
          <span>Workspace Launcher</span>
          <span className="text-[11px] text-text-faint">
            <Icon name="chevronRight" size={11} />
          </span>
          <span className="font-medium text-text-muted">{activeWorkspace?.name ?? ''}</span>
        </div>

        <div
          className="mx-auto flex h-7.5 max-w-85 flex-1 items-center gap-1.75 rounded-sm border border-border bg-bg px-2.5 text-[12.5px] text-text-faint"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Icon name="search" size={13} />
          <span>Search workspaces</span>
          <span className="ml-auto rounded-[4px] border border-border-strong px-1.25 py-px text-[10.5px] leading-[1.4] text-text-faint">
            ⌘K
          </span>
        </div>

        {/* On Windows/Linux, widened to leave room for the real
            titleBarOverlay minimize/maximize/close cluster
            (main/index.ts) so it doesn't render on top of this content
            — best-effort width, UNVERIFIED against a real Windows/
            Linux window (see WCs/WC__project-status.md). */}
        <div className={isDarwin ? 'w-19 shrink-0' : 'w-[138px] shrink-0'} />
      </div>

      {loadError && (
        <div className="m-4 flex shrink-0 items-center gap-2 rounded-sm border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] text-text-muted">
          <Icon name="x" size={13} className="text-danger" />
          <span>Failed to load workspaces: {loadError}</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          workspaces={workspaces}
          activeId={activeId}
          onSelect={setActiveId}
          onNewWorkspace={() => {
            setCreateModalOpen(true);
          }}
          onEditWorkspace={setEditingWorkspace}
          onDeleteWorkspace={setDeletingWorkspace}
        />

        {activeWorkspace && (
          <Detail
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            onEditWorkspace={setEditingWorkspace}
            onDeleteWorkspace={setDeletingWorkspace}
          />
        )}
      </div>

      <WorkspaceFormModal
        open={isCreateModalOpen || editingWorkspace !== null}
        editingWorkspace={editingWorkspace}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingWorkspace(null);
        }}
        onSaved={(config: WorkspaceConfig) => {
          setCreateModalOpen(false);
          setEditingWorkspace(null);
          void refreshWorkspaces(config.id);
        }}
      />

      <DeleteWorkspaceConfirm
        workspace={deletingWorkspace}
        onClose={() => {
          setDeletingWorkspace(null);
        }}
        onDeleted={(id) => {
          // Defense-in-depth on top of DeleteWorkspaceConfirm's own
          // close-blocking-while-deleting guard: only clear the dialog
          // if it's still showing the workspace that was actually
          // deleted, not whatever a later-opened dialog is showing now.
          setDeletingWorkspace((current) => (current?.id === id ? null : current));
          void refreshWorkspaces();
        }}
      />
    </div>
  );
}
