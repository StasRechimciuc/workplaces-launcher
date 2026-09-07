import { useEffect, useState } from 'react';
import type { WorkspaceDisplay } from '../../preload';
import { Icon } from './icons';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';

export function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceDisplay[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .listWorkspaces()
      .then((loaded) => {
        setWorkspaces(loaded);
        setActiveId((current) => current || (loaded[0]?.id ?? ''));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load workspaces: ${message}`);
        setLoadError(message);
      });
  }, []);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeId);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-bg">
      <div
        className="flex h-13 shrink-0 items-center gap-4 border-b border-border bg-bg-elevated px-3.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Reserves the space macOS's real traffic lights render into
            — see trafficLightPosition in main/index.ts. */}
        <div className="w-13 shrink-0" />

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

        <div className="w-19 shrink-0" />
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
        />

        {activeWorkspace && <Detail key={activeWorkspace.id} workspace={activeWorkspace} />}
      </div>

      <CreateWorkspaceModal
        open={isCreateModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
        }}
      />
    </div>
  );
}
