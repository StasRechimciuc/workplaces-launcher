import {
  getFirstTerminalCommands,
  mergeFirstTerminalCommands,
} from '../../lib/vscode-terminal-params';
import { EditableStringList } from '../EditableStringList';
import type { StepFieldsProps } from './types';

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
}: StepFieldsProps): JSX.Element {
  const commands = getFirstTerminalCommands(params);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={registerPrimaryInputRef}
        className="h-8 w-full rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
        type="text"
        placeholder="e.g. ~/projects/client-c"
        value={typeof params['path'] === 'string' ? params['path'] : ''}
        onChange={(e) => {
          onChange({ path: e.target.value });
        }}
      />
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
