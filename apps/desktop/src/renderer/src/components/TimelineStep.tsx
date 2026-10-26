import type { StepResult, TerminalCommandResult } from '@workspace-launcher/shared';
import { asTerminalFailureDetail } from '@workspace-launcher/shared';
import type { WorkspaceToolStepDisplay } from '../../../preload';
import { Icon } from '../icons';
import { cn } from '../lib/utils';
import type { SpotifyConnection } from '../lib/useSpotifyConnection';
import type { AppPathDetection } from '../lib/useAppPathDetections';
import { stepLaunchTimeLabel, stepLaunchTimeTooltip } from '../lib/launch-time-display';
import { formatPreciseDuration } from '@workspace-launcher/shared';
import { getRestoreResultTreatment } from '../lib/restore-result-treatment';
import { getStepFieldsComponent, stepFieldsIsCollapsible } from './step-fields/registry';
import { ToolBadge } from './ToolBadge';
import { ErrorCode } from './ErrorCode';

interface TimelineStepProps {
  tool: WorkspaceToolStepDisplay;
  index: number;
  isLast: boolean;
  isOpen: boolean;
  onToggle: () => void;
  recentFolders: string[];
  recentCommands: string[];
  spotify: SpotifyConnection;
  /** See step-fields/types.ts's StepFieldsProps — forwarded verbatim,
   * only vscode/chrome/spotify/clockify-fields.tsx read it. Absent for
   * any other tool type (Fields is undefined for those regardless). */
  appPathDetection?: AppPathDetection;
  /** null = no edits made yet in this step's fields (Save stays
   * disabled) — distinct from "edited back to the original value,"
   * which this codebase's established taste treats as an acceptable
   * simplification over deep-diffing. */
  draftParams: Record<string, unknown> | null;
  onDraftChange: (params: Record<string, unknown>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveError: { message: string; code?: string } | null;
  onShowErrorCode: (code: string) => void;
  /** Removes this step from the workspace entirely — a quick, direct
   * action (no confirmation dialog), matching this app's existing
   * precedent for removing a single item within an already-editing
   * context (WorkspaceFormModal's removeTool, EditableStringList's own
   * remove row) rather than the heavier, confirmed "Delete workspace"
   * flow, which discards the whole workspace with no way back. */
  onRemove: () => void;
  isRemoving: boolean;
  /**
   * This step's outcome from the most recent restore, if any — absent
   * when the step has never been restored, or wasn't covered by the
   * last restore attempt (e.g. added since). Ignored entirely while
   * `isOpen` — entering edit mode always reverts a row to its neutral
   * "plan" look, unconditionally, since a shown result is a statement
   * about a specific saved config that's stale the instant that config
   * starts being edited (this was a deliberate, researched call, not
   * an oversight — see this feature's own design notes).
   */
  result?: StepResult;
  onRetryStep?: (index: number) => void;
  retryingIndex?: number | null;
  retryDisabled?: boolean;
  /**
   * True once a restore has happened at all (`restoreResults !== null`
   * in Detail.tsx), regardless of whether THIS specific step has a
   * `result`. Lets a step with no result be told apart from a step
   * that's simply never been restored at all — e.g. one added to the
   * workspace after the last restore ran.
   */
  hasRestoreResults?: boolean;
}

const STATUS_BADGE_BASE =
  'absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-bg-elevated';

/** Small corner badge on the tool logo once a result exists — the
 * quick, read-at-a-glance signal; the row's own text carries the
 * specific reason. */
function statusBadge(treatment: ReturnType<typeof getRestoreResultTreatment>): JSX.Element {
  switch (treatment) {
    case 'success':
      return (
        <span className={cn(STATUS_BADGE_BASE, 'bg-success')}>
          <Icon name="check" size={8} className="text-bg" />
        </span>
      );
    case 'skipped':
      return (
        <span className={cn(STATUS_BADGE_BASE, 'bg-text-faint')}>
          <Icon name="minus" size={8} className="text-bg" />
        </span>
      );
    case 'started-then-failed':
      // Distinct from the solid-red cases below — the terminal DID
      // open and the command DID start running, it just ended badly.
      // Same half-green/half-red split already used for this exact
      // concept in RestoreResultsLegend.tsx's per-step bar and the
      // sidebar's own per-workspace dot — "something real happened
      // before this broke" must not look identical to "nothing ever
      // got going at all" (`not-started`), which is what prompted this
      // fix: a Docker step whose daemon came up fine and whose
      // terminal opened fine, with only the configured command itself
      // failing, read as a flat, undifferentiated failure.
      return (
        <span
          className={cn(
            STATUS_BADGE_BASE,
            'bg-gradient-to-r from-success from-50% to-danger to-50%',
          )}
        />
      );
    case 'not-started':
    case 'failed':
      return (
        <span className={cn(STATUS_BADGE_BASE, 'bg-danger')}>
          <Icon name="x" size={8} className="text-bg" />
        </span>
      );
  }
}

/** One configured command's line inside a terminal/Tilt entry's
 * breakdown — success is a single muted line (nothing more to say),
 * failed gets the full monospace box with its exit code + reason,
 * not-run gets the dashed "didn't get a chance to run" stub. */
function CommandLine({ command }: { command: TerminalCommandResult }): JSX.Element {
  if (command.status === 'success') {
    return (
      <div className="flex items-center gap-1.5 pl-1 text-[11.5px] text-text-faint">
        <Icon name="check" size={10} className="text-success" />
        <span className="truncate font-mono" title={command.command}>
          {command.command}
        </span>
      </div>
    );
  }

  if (command.status === 'not-run') {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-dashed border-border px-2 py-1.5 text-[11.5px] text-text-faint">
        <Icon name="minus" size={11} />
        <span className="truncate font-mono" title={command.command}>
          {command.command}
        </span>
        <span className="ml-auto shrink-0">Not run</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-danger/40 bg-bg px-2 py-1.5 font-mono text-[11.5px]">
      <span className="truncate text-text-muted" title={command.command}>
        <span className="text-text-faint">$ </span>
        {command.command}
      </span>
      <span className="text-text-faint">
        <span className="font-semibold text-danger">exit {command.exitCode}</span> {command.reason}
      </span>
    </div>
  );
}

/** The structured two/three-stage breakdown for a terminal/Tilt-engine
 * failure — one block per configured terminal entry. Absent entirely
 * for a plain one-shot failure (an app that couldn't launch, a Chrome
 * tab that failed) — those just keep the single ErrorCode line above,
 * nothing more to break down. */
function TerminalBreakdown({ result }: { result: StepResult }): JSX.Element | null {
  const detail = asTerminalFailureDetail(result.details);
  if (!detail) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {detail.entries.map((entry, entryIndex) =>
        entry.openFailed ? (
          <div
            key={entryIndex}
            className="flex items-center gap-2 rounded-sm border border-dashed border-border px-2 py-1.5 text-[11.5px] text-text-faint"
          >
            <Icon name="minus" size={11} />
            <span className="truncate" title={entry.cwd}>
              {entry.cwd}
            </span>
            <span className="ml-auto shrink-0">Not run · {entry.openFailed.reason}</span>
          </div>
        ) : (
          <div key={entryIndex} className="flex flex-col gap-1">
            {entry.commands.map((command) => (
              <CommandLine key={command.index} command={command} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

export function TimelineStep({
  tool,
  index,
  isLast,
  isOpen,
  onToggle,
  recentFolders,
  recentCommands,
  spotify,
  appPathDetection,
  draftParams,
  onDraftChange,
  onSave,
  onCancel,
  isSaving,
  saveError,
  onShowErrorCode,
  onRemove,
  isRemoving,
  result,
  onRetryStep,
  retryingIndex = null,
  retryDisabled = false,
  hasRestoreResults = false,
}: TimelineStepProps): JSX.Element {
  // See `result`'s own doc comment — isOpen always wins over the
  // DETAIL content (the message/breakdown row reverts to the plain
  // plan text while editing, since that content IS specific to a saved
  // config that's stale the instant editing starts). The corner status
  // badge on the tool icon is deliberately a SEPARATE decision from
  // `showResult` below, NOT gated on `!isOpen` — expanding a row to
  // look at (or tweak) its config is not the same as having actually
  // changed anything yet, and hiding "this succeeded/failed last time"
  // the moment you merely open the row to look was confirmed
  // confusing in real use: the badge should stay put until a save
  // actually happens, not disappear just from expanding.
  const treatment = result !== undefined ? getRestoreResultTreatment(result) : undefined;
  const showResult = result !== undefined && !isOpen;
  const dimmed = treatment === 'skipped';
  // Inline quick-edit reuses the exact same per-tool field component
  // the "Edit workspace" modal uses (real pickers — Chrome's profile
  // list, Spotify's OAuth+playlist picker, VS Code's folder dialog —
  // not a raw text box that would regress that work back to manual
  // typing). Only offered for types that actually have one registered
  // AND are collapsible per the registry — a type with genuinely
  // nothing to configure (Clockify) has no registry entry at all, so
  // stepFieldsIsCollapsible falls back to false for it, same as this
  // check already does for Docker/Terminal/Slack. Without this check,
  // a type with a fields component but no real content would wrongly
  // gain an expand affordance and a pointless Save/Cancel pair.
  const Fields = stepFieldsIsCollapsible(tool.type) ? getStepFieldsComponent(tool.type) : undefined;

  // Nothing structured to show for this step (an unbuilt tool type, or
  // one missing its required params) — hide the expand affordance
  // entirely rather than let it open onto an empty box. The one-line
  // `detail` text above already says everything there is to say for
  // these cases. A type with editable Fields but no expand() rows
  // today still counts as expandable, since Fields is itself real
  // content to show.
  const hasExpand = (tool.expand?.length ?? 0) > 0 || Fields !== undefined;

  return (
    <div className="flex gap-3.5">
      <div className="flex shrink-0 flex-col items-center">
        <div className="font-serif flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg-elevated text-[10.5px] font-semibold text-accent">
          {index + 1}
        </div>
        {!isLast && <div className="mt-0.5 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-5.5')}>
        <div
          className={cn('group flex items-center gap-2.5', hasExpand && 'cursor-pointer')}
          onClick={hasExpand ? onToggle : undefined}
        >
          <span className="relative shrink-0">
            <ToolBadge
              type={tool.type}
              icon={tool.icon}
              color={tool.color}
              size={15}
              chipClassName={cn('h-7 w-7 text-[15px]', dimmed && 'opacity-60')}
              params={tool.params}
            />
            {treatment !== undefined && statusBadge(treatment)}
          </span>
          <span
            className={cn('text-[13.5px] font-medium', dimmed ? 'text-text-faint' : 'text-text')}
          >
            {tool.name}
          </span>
          {result !== undefined ? (
            // A real, single measurement from the last restore —
            // precise to a decimal, not the estimate below (which is
            // an average across past runs — see formatPreciseDuration's
            // own doc comment for why these are two different
            // formatters, not one). Deliberately NOT gated on
            // `showResult`/`!isOpen` — same reasoning as the corner
            // status badge above: expanding the row to look at its
            // config shouldn't make the real last-restore time vanish
            // back into a generic estimate, only actually saving a
            // change should.
            <span
              className="flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-1.75 py-px text-[11px] text-text-faint"
              title="How long this step actually took on the last restore"
            >
              <Icon name="clock" size={10} />
              {formatPreciseDuration(result!.durationMs)}
            </span>
          ) : (
            // tool.launchTime is real (on macOS) or honestly-absent
            // launch-time data (step-timing-history.ts, via
            // workspace-display.ts) — "launch," not "restore"/"ready":
            // some apps may still be finishing their own startup after
            // this point. A bare number with no icon/label gave no hint
            // it was about timing at all — the clock icon + tooltip make
            // that explicit regardless of state.
            <span
              className="flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-1.75 py-px text-[11px] text-text-faint"
              title={stepLaunchTimeTooltip(tool.launchTime)}
            >
              <Icon name="clock" size={10} />
              {stepLaunchTimeLabel(tool.launchTime)}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {showResult && treatment !== 'success' && treatment !== 'skipped' && onRetryStep && (
              <button
                type="button"
                disabled={retryingIndex !== null || retryDisabled}
                title="Retries this step's whole configuration, including any commands that already succeeded"
                className="flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border-strong px-2 text-[11px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryStep(index);
                }}
              >
                <Icon name="refresh" size={11} />
                {retryingIndex === index ? 'Retrying…' : 'Retry'}
              </button>
            )}
            {/* Always available, any step type — shown only on hover,
                same reveal convention as the pencil below, so an
                ordinary row doesn't read as cluttered/deletable by
                default. */}
            <button
              type="button"
              aria-label={`Remove ${tool.name}`}
              disabled={isRemoving}
              className={cn(
                'flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-[5px] text-text-faint transition-opacity duration-140 hover:bg-bg-hover hover:text-danger disabled:pointer-events-none',
                // Forced fully visible while removing, not left to
                // group-hover — the mouse very plausibly isn't still
                // over this row for the whole (async, IPC-round-trip)
                // duration of a remove, and opacity-0 with no hover
                // would make the spinner invisible the moment it moves
                // away: no loading state at all, just a row that
                // silently stops responding for a moment.
                isRemoving ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={(e) => {
                // Must never also trigger the row's own onToggle
                // (expand/collapse) — the two are independent actions
                // sharing one clickable header.
                e.stopPropagation();
                onRemove();
              }}
            >
              <Icon
                name={isRemoving ? 'refresh' : 'trash'}
                size={13}
                {...(isRemoving ? { className: 'animate-spin' } : {})}
              />
            </button>
            {hasExpand && Fields && (
              // Editable rows (vscode/chrome/spotify) get a pencil, shown
              // only on hover — a chevron reads as "expand to view," but
              // this row expands into a real edit form, and the
              // always-visible chevron it replaced cluttered every row
              // with an affordance that's only relevant while hovering.
              <span className="flex shrink-0 items-center text-text-faint opacity-0 transition-opacity duration-140 group-hover:opacity-100">
                <Icon name="pencil" size={13} />
              </span>
            )}
            {hasExpand && !Fields && (
              // Static read-only detail rows (a type with nothing
              // editable) are a plain "view details" expand — the
              // chevron's meaning still holds here, so it stays as it
              // was: always visible, rotating open.
              <span
                className={cn(
                  'flex shrink-0 items-center text-text-faint transition-transform duration-140',
                  isOpen && 'rotate-90',
                )}
              >
                <Icon name="chevronRight" size={13} />
              </span>
            )}
          </span>
        </div>
        {result !== undefined ? (
          // Same reasoning as the corner badge/time pill above: the
          // actual last-restore outcome (the error headline, exit
          // code, captured output) is real, useful information while
          // fixing a broken step's config, not something that should
          // vanish into generic plan text just from opening the row —
          // it stays, with the edit form rendering right below it.
          <div className="mt-1.25 ml-9.5 text-[12.5px] leading-[1.4]">
            <ErrorCode message={result.message} code={result.code} onLearnMore={onShowErrorCode} />
            <TerminalBreakdown result={result} />
          </div>
        ) : (
          <p className="mt-1.25 ml-9.5 text-[12.5px] leading-[1.4] text-text-muted">
            {tool.detail}
            {/* A restore happened, but THIS step has no result from it
                — distinguishes "added since the last restore" from a
                workspace that's simply never been restored at all
                (hasRestoreResults false). Not gated on `!isOpen` either,
                same reasoning as everywhere else on this row. */}
            {hasRestoreResults && (
              <span className="ml-1.5 text-text-faint italic">· Added since last restore</span>
            )}
          </p>
        )}

        {isOpen && Fields && (
          <div className="mt-2.5 ml-9.5 flex flex-col gap-2 rounded-sm border border-border bg-bg-elevated px-3 py-2.5">
            <Fields
              params={draftParams ?? tool.params}
              onChange={(next) => {
                onDraftChange({ ...(draftParams ?? tool.params), ...next });
              }}
              // No "focus the newly-added row" concept here — same
              // received-but-unused precedent ChromeFields/SpotifyFields/
              // ClockifyFields already establish for this prop.
              registerPrimaryInputRef={() => {}}
              {...(tool.type === 'vscode' ? { recentFolders } : {})}
              {...(tool.type === 'terminal' ? { recentCommands } : {})}
              {...(tool.type === 'spotify' ? { spotify } : {})}
              {...(appPathDetection !== undefined ? { appPathDetection } : {})}
            />
            {/* Only shown once there's an actual change to act on — with
                nothing edited yet, Save has nothing to persist and
                Cancel has nothing to revert, so a permanently-visible
                (merely disabled) pair just reads as broken UI. */}
            {draftParams !== null && (
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <button
                  type="button"
                  disabled={isSaving}
                  className="flex h-6.5 items-center gap-1 rounded-sm border border-border-strong px-2 text-[11.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
                  onClick={onSave}
                >
                  <Icon name="check" size={12} />
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  className="flex h-6.5 items-center gap-1 rounded-sm border border-border-strong px-2 text-[11.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
                  onClick={onCancel}
                >
                  <Icon name="x" size={12} />
                  Cancel
                </button>
                {saveError && (
                  <span className="text-[11px] text-danger">
                    <ErrorCode
                      message={saveError.message}
                      code={saveError.code}
                      onLearnMore={onShowErrorCode}
                    />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {isOpen && !Fields && tool.expand && tool.expand.length > 0 && (
          <div className="mt-2.5 ml-9.5 flex flex-col gap-1.5 rounded-sm border border-border bg-bg-elevated px-3 py-2.5">
            {tool.expand.map((row, i) => (
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
