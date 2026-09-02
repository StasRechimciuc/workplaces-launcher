import { useEffect, useState } from 'react';
import type { WorkspaceDisplay } from '../../preload';
import { Icon } from './icons';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { CreateWorkspaceModal } from './components/CreateWorkspaceModal';

export function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceDisplay[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isMobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    void window.api.listWorkspaces().then((loaded) => {
      setWorkspaces(loaded);
      setActiveId((current) => current || (loaded[0]?.id ?? ''));
    });
  }, []);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeId);

  return (
    <div className={`window ${isMobileDetailOpen ? 'mobile-detail-open' : ''}`}>
      <div className="titlebar">
        <div className="titlebar-traffic-light-spacer" />
        <div className="titlebar-crumb">
          <span>Workspace Launcher</span>
          <span className="crumb-sep" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            <Icon name="chevronRight" size={11} />
          </span>
          <span className="crumb-current">{activeWorkspace?.name ?? ''}</span>
        </div>
        <div className="titlebar-search">
          <span style={{ fontSize: 13 }}>
            <Icon name="search" size={13} />
          </span>
          <span>Search workspaces</span>
          <span className="kbd">⌘K</span>
        </div>
        <div className="titlebar-right" />
      </div>

      <div className="window-body">
        <Sidebar
          workspaces={workspaces}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setMobileDetailOpen(true);
          }}
          onNewWorkspace={() => {
            setCreateModalOpen(true);
          }}
        />

        {activeWorkspace && (
          <Detail
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            onBackMobile={() => {
              setMobileDetailOpen(false);
            }}
          />
        )}
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
