import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { tagColor } from '../constants';

interface SidebarProps {
  workspaces: WorkspaceDisplay[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewWorkspace: () => void;
}

export function Sidebar({
  workspaces,
  activeId,
  onSelect,
  onNewWorkspace,
}: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="layers" />
        </span>
        <span className="brand-name">Workspace Launcher</span>
        <span className="brand-badge">Beta</span>
      </div>

      <button className="btn-new-workspace" type="button" onClick={onNewWorkspace}>
        <Icon name="plus" />
        New workspace
      </button>

      <div className="sidebar-sep" />

      <div className="workspace-list">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`workspace-item ${ws.id === activeId ? 'active' : ''}`}
            onClick={() => {
              onSelect(ws.id);
            }}
          >
            <span className="workspace-tag" style={{ background: tagColor(ws.tag) }} />
            <div className="workspace-info">
              <div className="workspace-name">{ws.name}</div>
              <div className="workspace-sub">{ws.subtitle}</div>
            </div>
            <span className="workspace-kebab">
              <Icon name="more" size={13} />
            </span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-settings" type="button">
          <Icon name="settings" size={15} />
          Settings
        </button>
      </div>
    </aside>
  );
}
