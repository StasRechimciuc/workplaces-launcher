import type { StepResult } from '@workspace-launcher/shared';
import type { WorkspaceToolStepDisplay } from '../../../preload';
import { cn } from '../lib/utils';
import { getRestoreResultTreatment } from '../lib/restore-result-treatment';
import { ToolBadge } from './ToolBadge';

interface RestoreResultsLegendProps {
  results: StepResult[];
  tools: WorkspaceToolStepDisplay[];
}

/**
 * Fixed per-segment width — small enough that a 10+-step workspace
 * doesn't force the window wider, large enough that the tool icon
 * above each bar stays legible. Past this many segments the strip
 * scrolls horizontally (`overflow-x-auto` below) rather than shrinking
 * segments indefinitely, which is the one place in this codebase that
 * introduces that pattern (no existing "many small items" row to
 * match — confirmed before building this).
 */
const SEGMENT_WIDTH_PX = 34;

const BAR_CLASS_BY_TREATMENT: Record<ReturnType<typeof getRestoreResultTreatment>, string> = {
  success: 'bg-success',
  skipped: 'bg-text-faint/40',
  failed: 'bg-danger',
  'not-started': 'bg-danger',
  'started-then-failed': 'bg-gradient-to-r from-success from-50% to-danger to-50%',
};

/**
 * A compact, hoverable overview strip above the per-step row list —
 * one segment per configured step, in order, so a workspace with many
 * steps is scannable at a glance before reading any row's text. Purely
 * additive to the row list below it (same data, same `getRestoreResult
 * Treatment` categorization) — never the only way to see a step's
 * outcome, just a faster one.
 */
export function RestoreResultsLegend({ results, tools }: RestoreResultsLegendProps): JSX.Element {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {results.map((result, i) => {
        const tool = tools[i];
        const treatment = getRestoreResultTreatment(result);
        return (
          <span
            key={i}
            title={`${tool?.name ?? `Step ${i + 1}`} · ${treatment.replace(/-/g, ' ')}`}
            className="flex shrink-0 flex-col items-center gap-1"
            style={{ width: SEGMENT_WIDTH_PX }}
          >
            {tool && (
              <ToolBadge
                type={tool.type}
                icon={tool.icon}
                color={tool.color}
                size={11}
                chipClassName={cn('h-4.5 w-4.5', treatment === 'skipped' && 'opacity-60')}
                params={tool.params}
              />
            )}
            <span className={cn('h-1.5 w-full rounded-full', BAR_CLASS_BY_TREATMENT[treatment])} />
          </span>
        );
      })}
    </div>
  );
}
