import { useState } from 'react';
import {
  getFirstTerminalCommands,
  mergeFirstTerminalCommands,
} from '../../lib/vscode-terminal-params';
import { Icon } from '../../icons';
import { EditableStringList } from '../EditableStringList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { StepFieldsProps } from './types';
import { FIELD_GROUP_LABEL_CLASS, ResolvedAppPath } from './ResolvedAppPath';
import { ProjectPathSuggestionChip } from './ProjectPathSuggestionChip';
import { PATH_INPUT_CLASS, errorBorderClass } from './field-error';

/**
 * Terminal commands render via EditableStringList (individual removable
 * rows, not one multi-line textarea) — clicking "Add command" always
 * adds an editable-but-empty row directly, rather than typing free text
 * and having it split/parsed. An in-progress empty row is a normal,
 * valid intermediate UI state; it only surfaces as this tool's own
 * "each command must be a non-empty string" save-time validation error
 * if the user tries to save before filling it in or removing it — same
 * as any other required field in this form, not a special case.
 */
export function VscodeFields({
  params,
  onChange,
  registerPrimaryInputRef,
  recentFolders,
  appPathDetection,
  fieldErrors,
  projectPathSuggestion,
}: StepFieldsProps): JSX.Element {
  const commands = getFirstTerminalCommands(params);
  const path = typeof params['path'] === 'string' ? params['path'] : '';
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'] : '';
  // Local, not threaded from the parent — a second concurrent dialog
  // from a DIFFERENT row isn't prevented by this (isBrowsing is per-row
  // state), only a second click on this same row's own button while
  // its first pick is still in flight. Acceptable for a first slice.
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function handleBrowse(): Promise<void> {
    setIsBrowsing(true);
    try {
      const selected = await window.api.selectProjectFolder();
      if (selected !== null) {
        onChange({ path: selected });
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_GROUP_LABEL_CLASS}>App</span>
      <ResolvedAppPath
        toolLabel="VS Code"
        appPath={appPath}
        onChange={onChange}
        detection={appPathDetection!}
      />

      <span className={`${FIELD_GROUP_LABEL_CLASS} mt-1`}>Project folder</span>
      {!path && projectPathSuggestion && (
        <ProjectPathSuggestionChip
          label={
            <>
              Use {projectPathSuggestion.sourceLabel}&rsquo;s folder: {projectPathSuggestion.path}
            </>
          }
          onClick={() => {
            onChange({ path: projectPathSuggestion.path });
          }}
        />
      )}
      <div className="flex items-center gap-1.5">
        <input
          ref={registerPrimaryInputRef}
          className={errorBorderClass(PATH_INPUT_CLASS, fieldErrors?.['path'])}
          type="text"
          placeholder="e.g. ~/projects/client-c"
          value={path}
          onChange={(e) => {
            onChange({ path: e.target.value });
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
      {fieldErrors?.['path'] && <p className="text-[11px] text-danger">{fieldErrors['path']}</p>}

      {recentFolders && recentFolders.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-fit items-center gap-1.25 self-start rounded-[5px] px-1.5 text-[11px] text-text-faint hover:bg-bg-hover hover:text-text-muted"
            >
              <Icon name="clock" size={11} />
              Recent
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {recentFolders.map((folder) => (
              <DropdownMenuItem
                key={folder}
                title={folder}
                className="max-w-72 truncate"
                onSelect={() => {
                  onChange({ path: folder });
                }}
              >
                {folder}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <p className="text-[11px] text-text-faint">
        Optional — commands to run in a terminal when this workspace is restored. Requires the
        Workspace Launcher VS Code extension.
      </p>
      <EditableStringList
        values={commands}
        onChange={(next) => {
          onChange({ terminals: mergeFirstTerminalCommands(params, next) });
        }}
        placeholder="e.g. npm run dev"
        addLabel="Add command"
        removeAriaLabel="Remove command"
        inputClassName="font-mono text-[12px]"
      />
    </div>
  );
}
