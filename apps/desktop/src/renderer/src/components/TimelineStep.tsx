import type { WorkspaceToolStepDisplay } from '../../../preload';
import { Icon } from '../icons';
import { toolColor } from '../constants';

interface TimelineStepProps {
  tool: WorkspaceToolStepDisplay;
  index: number;
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function TimelineStep({
  tool,
  index,
  isLast,
  isOpen,
  onToggle,
}: TimelineStepProps): JSX.Element {
  const colors = toolColor(tool.color);

  return (
    <div className="timeline-row">
      <div className="timeline-rail">
        <div className="timeline-index">{index + 1}</div>
        {!isLast && <div className="timeline-line" />}
      </div>
      <div className="timeline-content">
        <div className={`tool-top ${isOpen ? 'expanded' : ''}`} onClick={onToggle}>
          <span className="tool-icon" style={{ background: colors.bg, color: colors.fg }}>
            <Icon name={tool.icon} size={15} />
          </span>
          <span className="tool-name">{tool.name}</span>
          <span className="tool-time">{tool.time}</span>
          <span className="tool-chevron">
            <Icon name="chevronRight" size={13} />
          </span>
        </div>
        <p className="tool-detail">{tool.detail}</p>
        <div className={`tool-expand ${isOpen ? 'open' : ''}`}>
          {(tool.expand ?? []).map((row, i) => (
            <div className="tool-expand-row" key={i}>
              <Icon name={row.i} size={13} />
              <span>
                {row.label}
                {row.mono ? ':' : ''}
              </span>
              {row.mono && <code>{row.mono}</code>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
