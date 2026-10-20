import { useEffect, useState } from 'react';
import { appDisplayName } from '@workspace-launcher/shared';
import { Icon } from '../../icons';
import type { AppPathDetection } from '../../lib/useAppPathDetections';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { classifyAppPathCandidates } from './resolve-app-path';

const BUTTON_CLASS =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.25 text-[12px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50';

/** Shared small section-label style for a tool's fields panel — e.g.
 * "App" above this component, "Project folder"/"Profile"/"Playlist"
 * above whatever comes next. Without it, this row ("✓ Visual Studio
 * Code · Not this app? Choose manually") and an unrelated field right
 * below it (vscode's project-folder input, say) read as one continuous
 * thing with no indication the app row ends there. Exported from here
 * since every consumer places a
 * label immediately before this component. */
export const FIELD_GROUP_LABEL_CLASS =
  'text-[10px] font-semibold tracking-[0.04em] text-text-faint uppercase';

interface ResolvedAppPathProps {
  toolLabel: string;
  appPath: string;
  onChange: (params: Record<string, unknown>) => void;
  detection: AppPathDetection;
}

async function chooseManually(onChange: (params: Record<string, unknown>) => void): Promise<void> {
  const selected = await window.api.selectApp();
  if (selected !== null) {
    onChange({ appPath: selected });
  }
}

/**
 * Shows which real, installed app this step will actually launch, and
 * lets the user see/correct it — never hides resolution behind a
 * silent fallback. This is the core fix the whole real-launch-path
 * feature exists for: a prior tool in this exact space (PowerToys
 * Workspaces) shipped a real bug where silent name-based resolution
 * launched the wrong app, with no way for the user to notice. Shared
 * across vscode/chrome/spotify/clockify-fields.tsx rather than
 * duplicated 4x — identical state machine and IPC call in all four,
 * only the tool label/type varies.
 *
 * Once `appPath` is non-empty (auto-filled, overridden, or loaded from
 * an already-saved config), detection is never re-triggered for this
 * row again, even across further collapse/expand — re-running it
 * after a value already exists would risk silently second-guessing a
 * choice already made, exactly the failure mode this exists to avoid.
 */
export function ResolvedAppPath({
  toolLabel,
  appPath,
  onChange,
  detection,
}: ResolvedAppPathProps): JSX.Element {
  const [isPicking, setIsPicking] = useState(false);

  useEffect(() => {
    if (!appPath && detection.state.status === 'idle') {
      detection.detect();
    }
    // Fires once per mount (= once per row expand) — a no-op the
    // moment appPath is set or a detection result already exists for
    // this tool type, via detect()'s own in-flight/done guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChooseManually(): void {
    setIsPicking(true);
    chooseManually(onChange).finally(() => {
      setIsPicking(false);
    });
  }

  if (appPath) {
    return (
      <div className="flex items-center gap-1.5">
        <Icon name="check" size={12} className="text-success" />
        <span className="min-w-0 truncate text-[12px] text-text-muted" title={appPath}>
          {appDisplayName(appPath)}
        </span>
        <button
          type="button"
          disabled={isPicking}
          className="text-[11.5px] text-text-faint hover:text-text hover:underline disabled:pointer-events-none disabled:opacity-50"
          onClick={handleChooseManually}
        >
          Not this app? Choose manually
        </button>
      </div>
    );
  }

  if (detection.state.status === 'idle' || detection.state.status === 'detecting') {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-text-faint">
        <Icon name="search" size={12} />
        Looking for {toolLabel}…
      </div>
    );
  }

  if (detection.state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-danger">
          Couldn&rsquo;t check for {toolLabel} automatically — {detection.state.message}
        </span>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            detection.detect();
          }}
        >
          Retry
        </button>
        <button
          type="button"
          disabled={isPicking}
          className="text-[11.5px] text-text-faint hover:text-text hover:underline disabled:pointer-events-none disabled:opacity-50"
          onClick={handleChooseManually}
        >
          Choose manually
        </button>
      </div>
    );
  }

  const classification = classifyAppPathCandidates(detection.state.candidates ?? []);

  if (classification.kind === 'none') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-text-faint">
          Couldn&rsquo;t find {toolLabel} automatically — locate it manually.
        </span>
        <button
          type="button"
          disabled={isPicking}
          className={BUTTON_CLASS}
          onClick={handleChooseManually}
        >
          <Icon name="appWindow" size={12} />
          Choose app…
        </button>
      </div>
    );
  }

  if (classification.kind === 'single') {
    const candidate = classification.candidate;
    return (
      <div className="flex items-center gap-1.5">
        <Icon name="check" size={12} className="text-success" />
        <span className="min-w-0 truncate text-[12px] text-text-muted" title={candidate.path}>
          {candidate.displayName}
        </span>
        <button
          type="button"
          disabled={isPicking}
          className="text-[11.5px] text-text-faint hover:text-text hover:underline disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            onChange({ appPath: candidate.path });
          }}
        >
          Not this app? Choose manually
        </button>
      </div>
    );
  }

  // classification.kind === 'multiple'
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-text-faint">
        Found {classification.candidates.length} copies of {toolLabel} — choose the right one:
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={BUTTON_CLASS}>
            <Icon name="appWindow" size={12} />
            Choose {toolLabel} install…
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {classification.candidates.map((candidate) => (
            <DropdownMenuItem
              key={candidate.path}
              className="flex-col items-start gap-0"
              onSelect={() => {
                onChange({ appPath: candidate.path });
              }}
            >
              <span className="min-w-0 truncate">{candidate.displayName}</span>
              <span className="min-w-0 truncate text-[11px] text-text-faint">{candidate.path}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onSelect={() => {
              handleChooseManually();
            }}
          >
            None of these — choose manually…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
