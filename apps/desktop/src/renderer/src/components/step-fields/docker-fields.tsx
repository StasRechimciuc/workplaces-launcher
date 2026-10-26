import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { FIELD_GROUP_LABEL_CLASS } from './ResolvedAppPath';
import { ProjectPathSuggestionChip } from './ProjectPathSuggestionChip';
import { PATH_INPUT_CLASS, errorBorderClass } from './field-error';
import { sanitizeComposeProjectName } from '../../lib/compose-project-name';
import type { StepFieldsProps } from './types';

type DockerEngine = 'compose' | 'tilt';

function defaultUpCommand(engine: DockerEngine): string {
  return engine === 'tilt' ? 'tilt up' : 'docker compose up -d --wait --wait-timeout 120';
}

function defaultDownCommand(engine: DockerEngine): string {
  return engine === 'tilt' ? 'tilt down' : 'docker compose down';
}

// How long to wait after the directory field stops changing before
// scanning it — avoids firing a scan (and caching a result) per
// keystroke while the user is still typing a half-finished path.
// Browse/suggestion-chip picks go through the exact same debounced
// path rather than a separate immediate-trigger case: both just set
// `directory` via onChange like typing does, so one mechanism covers
// all three entry points.
const DETECT_DEBOUNCE_MS = 400;

/**
 * Scans the chosen directory for compose.yaml/docker-compose.yml vs.
 * Tiltfile (see the debounced effect below, and
 * lib/useProjectFilesDetection.ts) and auto-selects the engine plus a
 * sensible default command for each — pre-filled only while the field
 * still holds a prior engine's own default, or the detection's own
 * earlier auto-fill (never overwriting something the user actually
 * typed or explicitly chose via the Engine toggle, see
 * engineTouchedRef below).
 */
export function DockerFields({
  params,
  onChange,
  registerPrimaryInputRef,
  fieldErrors,
  projectPathSuggestion,
  projectFilesDetection,
}: StepFieldsProps): JSX.Element {
  const directory = typeof params['directory'] === 'string' ? params['directory'] : '';
  const engine: DockerEngine = params['engine'] === 'tilt' ? 'tilt' : 'compose';
  const upCommand = typeof params['upCommand'] === 'string' ? params['upCommand'] : '';
  const downCommand = typeof params['downCommand'] === 'string' ? params['downCommand'] : '';
  const stopOnClose = params['stopOnClose'] === true;
  const [isBrowsing, setIsBrowsing] = useState(false);
  // Flips permanently (for this row, this mount) the moment the user
  // clicks Compose/Tilt themselves — once that happens, auto-detection
  // never overrides their explicit choice again, even if a later
  // directory scan would otherwise suggest switching. Deliberately NOT
  // set by the auto-apply effect itself (an auto-applied engine is a
  // suggestion, not a user action — a later directory change can still
  // freely re-suggest a different one).
  const engineTouchedRef = useRef(false);
  // Skips the debounced scan on this row's very first render — a
  // directory that's already set when the component mounts (editing an
  // existing, already-configured step) shouldn't get silently re-scanned
  // and potentially rewritten just from opening the form. Only a real
  // subsequent change to `directory` (typing, Browse, a suggestion
  // accept) should ever trigger a scan.
  const isFirstRenderRef = useRef(true);
  // Same "skip on mount" guard, but for APPLYING an already-settled
  // detection result, not triggering a new scan — a real, previously-
  // missed bug: detection results are cached and shared by directory
  // string (useProjectFilesDetection), so a SECOND Docker step pointed
  // at the same directory as an already-scanned first one mounts with
  // `projectFilesDetection.state` already 'done'. Without this guard,
  // the effect below fires immediately on that mount and silently
  // overwrites the second row's engine/commands from the first row's
  // cached result, even though nothing about THIS row's directory ever
  // actually changed. A separate ref from isFirstRenderRef above —
  // effects run in declaration order within a commit, so sharing one
  // ref would have this effect observe it already flipped false by the
  // scan-trigger effect above running first in the same commit.
  const isFirstApplyRef = useRef(true);
  // Tracks the exact string WE last auto-filled into upCommand (either
  // a plain engine default from handleEngineChange, or the richer,
  // detection-baked variant from the effect below) — initialized to
  // the CURRENT engine's plain default, so a freshly-mounted, never-
  // customized row (where the saved value already IS that default)
  // still recognizes it as replaceable. Comparing against this instead
  // of a fixed `defaultUpCommand(engine)` string is what makes "is this
  // still ours to overwrite" survive BOTH kinds of auto-fill — the real
  // bug this fixes: after detection baked `docker compose -f x.yaml -p
  // name up ...` in, toggling the engine compared that baked string
  // against the bare default, never matched, and left a stale command
  // paired with the new engine (confirmed in real use, not theoretical).
  const autoFilledUpCommandRef = useRef(defaultUpCommand(engine));
  const autoFilledDownCommandRef = useRef(defaultDownCommand(engine));

  async function handleBrowse(): Promise<void> {
    setIsBrowsing(true);
    try {
      const selected = await window.api.selectProjectFolder();
      if (selected !== null) {
        onChange({ directory: selected });
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  function handleEngineChange(next: DockerEngine): void {
    engineTouchedRef.current = true;
    const update: Record<string, unknown> = { engine: next };
    // Only replace a command field that's empty or still equal to
    // whatever WE last auto-filled (plain default OR a detection-baked
    // variant) — never clobber a real edit.
    if (upCommand === '' || upCommand === autoFilledUpCommandRef.current) {
      update['upCommand'] = defaultUpCommand(next);
      autoFilledUpCommandRef.current = defaultUpCommand(next);
    }
    if (downCommand === '' || downCommand === autoFilledDownCommandRef.current) {
      update['downCommand'] = defaultDownCommand(next);
      autoFilledDownCommandRef.current = defaultDownCommand(next);
    }
    onChange(update);
  }

  // Debounced scan trigger — fires detect() for whatever `directory`
  // currently is, a beat after it last changed. `detect()` itself is a
  // no-op if this exact directory is already 'detecting'/'done' (see
  // useProjectFilesDetection's own dedup), so this is safe to call
  // repeatedly.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (!directory) return;
    const timer = setTimeout(() => {
      projectFilesDetection?.detect();
    }, DETECT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectFilesDetection is a fresh object each render (bound to `directory` by the parent); depending on `directory` alone is the real trigger condition and avoids re-arming the timer on every unrelated re-render.
  }, [directory]);

  // Applies a finished detection — auto-selects the engine and bakes
  // the real filename + a sanitized project name into the default
  // commands, but ONLY while those fields still hold their plain
  // defaults (same "never clobber a real edit" guard as
  // handleEngineChange above). Both-found and neither-found are left
  // alone here — the status message below covers those, since neither
  // has a single correct engine to pick.
  useEffect(() => {
    if (isFirstApplyRef.current) {
      isFirstApplyRef.current = false;
      return;
    }
    if (engineTouchedRef.current) return;
    const state = projectFilesDetection?.state;
    if (!state || state.status !== 'done' || !state.result) return;
    const { composeFile, hasTiltfile } = state.result;
    const commandsAreDefault = upCommand === '' || upCommand === autoFilledUpCommandRef.current;
    if (!commandsAreDefault) return;

    if (composeFile && !hasTiltfile) {
      const projectName = sanitizeComposeProjectName(directory);
      const newUpCommand = `docker compose -f ${composeFile} -p ${projectName} up -d --wait --wait-timeout 120`;
      const newDownCommand = `docker compose -f ${composeFile} -p ${projectName} down`;
      autoFilledUpCommandRef.current = newUpCommand;
      autoFilledDownCommandRef.current = newDownCommand;
      onChange({ engine: 'compose', upCommand: newUpCommand, downCommand: newDownCommand });
    } else if (hasTiltfile && !composeFile) {
      autoFilledUpCommandRef.current = 'tilt up';
      autoFilledDownCommandRef.current = 'tilt down';
      onChange({ engine: 'tilt', upCommand: 'tilt up', downCommand: 'tilt down' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the detection itself settles, not on every upCommand/engine/onChange identity change (those are read fresh via the commandsAreDefault guard, not meant to re-trigger this).
  }, [projectFilesDetection?.state.status, projectFilesDetection?.state.result]);

  const detection = projectFilesDetection?.state;
  const bothFound =
    detection?.status === 'done' &&
    !!detection.result?.composeFile &&
    !!detection.result.hasTiltfile;
  const neitherFound =
    detection?.status === 'done' &&
    !detection.result?.composeFile &&
    !detection.result?.hasTiltfile;
  const detectionFailed = detection?.status === 'error';

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_GROUP_LABEL_CLASS}>Project directory</span>
      <p className="-mt-0.5 text-[11px] text-text-faint">
        The folder containing your docker-compose.yml or Tiltfile — commands below run from here.
      </p>
      {!directory && projectPathSuggestion && (
        <ProjectPathSuggestionChip
          label={
            <>
              Use {projectPathSuggestion.sourceLabel}&rsquo;s folder: {projectPathSuggestion.path}
            </>
          }
          onClick={() => {
            onChange({ directory: projectPathSuggestion.path });
          }}
        />
      )}
      <div className="flex items-center gap-1.5">
        <input
          ref={registerPrimaryInputRef}
          className={errorBorderClass(PATH_INPUT_CLASS, fieldErrors?.['directory'])}
          type="text"
          placeholder="e.g. ~/projects/client-c"
          value={directory}
          onChange={(e) => {
            onChange({ directory: e.target.value });
          }}
        />
        <button
          type="button"
          disabled={isBrowsing}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-[12.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            void handleBrowse();
          }}
        >
          <Icon name="folder" size={12} />
          Browse…
        </button>
      </div>
      {fieldErrors?.['directory'] && (
        <p className="text-[11px] text-danger">{fieldErrors['directory']}</p>
      )}
      {bothFound && (
        <p className="text-[11px] text-text-faint">
          Found both a compose file and a Tiltfile here — choose which engine to use below.
        </p>
      )}
      {neitherFound && (
        <p className="text-[11px] text-text-faint">
          No compose file or Tiltfile found in this folder — you can still type commands manually.
        </p>
      )}
      {detectionFailed && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-danger">
            Couldn&rsquo;t check this folder automatically — {detection?.message}
          </span>
          <button
            type="button"
            className="text-[11px] text-text-muted underline hover:text-text"
            onClick={() => {
              projectFilesDetection?.detect();
            }}
          >
            Retry
          </button>
        </div>
      )}

      <span className={`${FIELD_GROUP_LABEL_CLASS} mt-1`}>Engine</span>
      <div className="flex gap-1.5">
        {(['compose', 'tilt'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={engine === option}
            className={`h-7 flex-1 rounded-sm border px-2.5 text-[12px] font-medium ${
              engine === option
                ? 'border-accent-border bg-accent-soft text-accent'
                : 'border-border-strong text-text-muted hover:bg-bg-hover'
            }`}
            onClick={() => {
              handleEngineChange(option);
            }}
          >
            {option === 'compose' ? 'Docker Compose' : 'Tilt'}
          </button>
        ))}
      </div>

      <span className={`${FIELD_GROUP_LABEL_CLASS} mt-1`}>Up command</span>
      <input
        className={errorBorderClass(
          'h-8 w-full rounded-sm border border-border-strong bg-bg px-2.5 font-mono text-[12px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none',
          fieldErrors?.['upCommand'],
        )}
        type="text"
        placeholder={defaultUpCommand(engine)}
        value={upCommand}
        onChange={(e) => {
          onChange({ upCommand: e.target.value });
        }}
      />
      {fieldErrors?.['upCommand'] && (
        <p className="text-[11px] text-danger">{fieldErrors['upCommand']}</p>
      )}

      <span className={`${FIELD_GROUP_LABEL_CLASS} mt-1`}>Down command</span>
      <input
        className={errorBorderClass(
          'h-8 w-full rounded-sm border border-border-strong bg-bg px-2.5 font-mono text-[12px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none',
          fieldErrors?.['downCommand'],
        )}
        type="text"
        placeholder={defaultDownCommand(engine)}
        value={downCommand}
        onChange={(e) => {
          onChange({ downCommand: e.target.value });
        }}
      />
      {fieldErrors?.['downCommand'] ? (
        <p className="text-[11px] text-danger">{fieldErrors['downCommand']}</p>
      ) : (
        <p className="text-[11px] text-text-faint">
          Never deletes volumes — a -v/--volumes down command is rejected when this step is saved.
        </p>
      )}

      <label className="mt-1 flex items-center gap-2 text-[12.5px] text-text-muted">
        <input
          type="checkbox"
          checked={stopOnClose}
          onChange={(e) => {
            onChange({ stopOnClose: e.target.checked });
          }}
        />
        Stop this stack when I close or switch away from this workspace
      </label>
    </div>
  );
}
