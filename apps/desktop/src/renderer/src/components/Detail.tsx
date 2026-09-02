import { useState } from 'react';
import type { WorkspaceDisplay } from '../../../preload';
import { Icon } from '../icons';
import { TimelineStep } from './TimelineStep';

interface DetailProps {
  workspace: WorkspaceDisplay;
  onBackMobile: () => void;
}

/**
 * Render key is the workspace id (see App.tsx) — React remounts this
 * component on workspace switch, which naturally resets expandedIndex
 * to null, same as the mockup's manual `expandedIndex = null` reset.
 */
export function Detail({ workspace, onBackMobile }: DetailProps): JSX.Element {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <main className="detail">
      <div className="detail-header">
        <div className="detail-heading">
          <button className="btn-back-mobile" type="button" onClick={onBackMobile}>
            <Icon name="arrowLeft" size={15} />
          </button>
          <div>
            <h1>{workspace.name}</h1>
            <p>{workspace.description}</p>
          </div>
        </div>
        <div className="detail-actions">
          <button className="btn-icon" type="button">
            <Icon name="more" size={15} />
          </button>
          <button className="btn-restore" type="button">
            <Icon name="zap" size={14} />
            Restore workspace
          </button>
        </div>
      </div>

      <div className="stats-row">
        <span className="stat-pill">
          <Icon name="check" size={12} /> {workspace.tools.length} tools
        </span>
        <span className="stat-pill">
          <Icon name="zap" size={12} /> {workspace.restoreTime} to restore
        </span>
        <span className="stat-pill">
          <Icon name="clock" size={12} /> Last restored {workspace.lastRestored}
        </span>
      </div>

      <div className="detail-sep" />

      <p className="section-kicker">Runs in order on restore</p>

      <div className="timeline">
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
