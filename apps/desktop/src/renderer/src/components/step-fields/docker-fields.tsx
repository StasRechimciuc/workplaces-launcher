import { useState } from 'react';
import { Icon } from '../../icons';
import { FIELD_GROUP_LABEL_CLASS } from './ResolvedAppPath';
import { errorBorderClass } from './field-error';
import type { StepFieldsProps } from './types';

type DockerEngine = 'compose' | 'tilt';

function defaultUpCommand(engine: DockerEngine): string {
  return engine === 'tilt' ? 'tilt up' : 'docker compose up -d --wait --wait-timeout 120';
}

function defaultDownCommand(engine: DockerEngine): string {
  return engine === 'tilt' ? 'tilt down' : 'docker compose down';
}

/**
 * No auto-detection of compose.yaml/docker-compose.yml/Tiltfile in this
 * first slice — the user picks Compose or Tilt explicitly and gets a
 * sensible, fully-editable default command for each, pre-filled only
 * while the field still holds a prior engine's own default (never
 * overwriting something the user actually typed). Scanning the chosen
 * directory for which file is actually there is a real, separate
 * improvement, left for a follow-up rather than silently promised here.
 */
export function DockerFields({
  params,
  onChange,
  registerPrimaryInputRef,
  fieldErrors,
}: StepFieldsProps): JSX.Element {
  const directory = typeof params['directory'] === 'string' ? params['directory'] : '';
  const engine: DockerEngine = params['engine'] === 'tilt' ? 'tilt' : 'compose';
  const upCommand = typeof params['upCommand'] === 'string' ? params['upCommand'] : '';
  const downCommand = typeof params['downCommand'] === 'string' ? params['downCommand'] : '';
  const stopOnClose = params['stopOnClose'] === true;
  const [isBrowsing, setIsBrowsing] = useState(false);

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
    const update: Record<string, unknown> = { engine: next };
    // Only replace a command field that's empty or still equal to the
    // OTHER engine's own default — never clobber a real edit.
    if (upCommand === '' || upCommand === defaultUpCommand(engine)) {
      update['upCommand'] = defaultUpCommand(next);
    }
    if (downCommand === '' || downCommand === defaultDownCommand(engine)) {
      update['downCommand'] = defaultDownCommand(next);
    }
    onChange(update);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_GROUP_LABEL_CLASS}>Project directory</span>
      <p className="-mt-0.5 text-[11px] text-text-faint">
        The folder containing your docker-compose.yml or Tiltfile — commands below run from here.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          ref={registerPrimaryInputRef}
          className={errorBorderClass(
            'h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none',
            fieldErrors?.['directory'],
          )}
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
