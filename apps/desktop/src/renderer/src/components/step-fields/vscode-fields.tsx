import {
  getFirstTerminalCommands,
  mergeFirstTerminalCommands,
} from '../../lib/vscode-terminal-params';
import type { StepFieldsProps } from './types';

/**
 * Verbatim move of WorkspaceFormModal.tsx's old 'vscode' StepParamsFields
 * branch — no logic changes, just relocated so a new tool type's fields
 * live in their own file instead of growing one shared if-chain.
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
        Optional — commands to run in a terminal when this workspace is restored (one per line).
        Requires the Workspace Launcher VS Code extension.
      </p>
      <textarea
        className="min-h-16 w-full resize-y rounded-sm border border-border-strong bg-bg px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
        placeholder={'One command per line (optional), e.g.\nnpm install\nnpm run dev'}
        value={commands.join('\n')}
        onChange={(e) => {
          const nextCommands = e.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          onChange({ terminals: mergeFirstTerminalCommands(params, nextCommands) });
        }}
      />
    </div>
  );
}
