import type { WorkspaceToolStepDisplay } from '../../../preload';
import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { ToolBadge } from './ToolBadge';

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
  // Nothing structured to show for this step (an unbuilt tool type, or
  // one missing its required params) — hide the expand affordance
  // entirely rather than let it open onto an empty box. The one-line
  // `detail` text above already says everything there is to say for
  // these cases.
  const hasExpand = (tool.expand?.length ?? 0) > 0;

  return (
    <div className="flex gap-3.5">
      <div className="flex shrink-0 flex-col items-center">
        <div className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg-elevated text-[10.5px] font-semibold text-text-faint">
          {index + 1}
        </div>
        {!isLast && <div className="mt-0.5 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-5.5')}>
        <div
          className={cn('group flex items-center gap-2.5', hasExpand && 'cursor-pointer')}
          onClick={hasExpand ? onToggle : undefined}
        >
          <ToolBadge
            type={tool.type}
            icon={tool.icon}
            color={tool.color}
            size={15}
            chipClassName="h-7 w-7 text-[15px]"
          />
          <span className="text-[13.5px] font-medium text-text">{tool.name}</span>
          <span className="rounded-full border border-border bg-bg-elevated px-1.75 py-px text-[11px] text-text-faint">
            {tool.time}
          </span>
          {hasExpand && (
            <span
              className={cn(
                'ml-auto flex shrink-0 items-center text-text-faint transition-transform duration-140',
                isOpen && 'rotate-90',
              )}
            >
              <Icon name="chevronRight" size={13} />
            </span>
          )}
        </div>
        <p className="mt-1.25 ml-9.5 text-[12.5px] leading-[1.4] text-text-muted">{tool.detail}</p>
        {hasExpand && isOpen && (
          <div className="mt-2.5 ml-9.5 flex flex-col gap-1.5 rounded-sm border border-border bg-bg-elevated px-3 py-2.5">
            {tool.expand!.map((row, i) => (
              <div className="flex items-center gap-2 text-xs text-text-muted" key={i}>
                <Icon name={row.i} size={13} className="text-text-faint" />
                <span>
                  {row.label}
                  {row.mono ? ':' : ''}
                </span>
                {row.mono && (
                  <code className="rounded-[4px] border border-border bg-bg px-1.5 py-px font-mono text-[11.5px] text-text">
                    {row.mono}
                  </code>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
