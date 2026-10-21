import { useRef, useState } from 'react';
import { Icon } from '../../icons';
import { EditableStringList } from '../EditableStringList';
import {
  addTerminalEntry,
  getTerminalEntries,
  removeTerminalEntry,
  updateTerminalEntry,
} from '../../lib/terminal-params';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { FIELD_GROUP_LABEL_CLASS } from './ResolvedAppPath';
import type { StepFieldsProps } from './types';

/**
 * Renders N terminal "cards," each a working directory (via the same
 * native folder-browse dialog VS Code's own path field uses — this
 * project's "no manual typing" principle applies here too) plus an
 * ordered list of commands (EditableStringList, same component VS
 * Code's terminal commands and Chrome's URLs already use).
 *
 * Keys each card by a locally-generated stable id, same reasoning as
 * EditableStringList's own rowIds doc comment — an index key would let
 * React reconcile the wrong DOM node onto a shifted card after
 * removing an earlier one, silently dropping keyboard focus.
 *
 * No registerPrimaryInputRef usage — starts with zero cards, same
 * "click Add to see the first row" precedent EditableStringList itself
 * already establishes for commands/URLs, not a special case here.
 */
export function TerminalFields({ params, onChange, recentCommands }: StepFieldsProps): JSX.Element {
  const entries = getTerminalEntries(params);
  const nextEntryIdRef = useRef(0);
  const [entryIds, setEntryIds] = useState<number[]>(() =>
    entries.map(() => nextEntryIdRef.current++),
  );
  // Tracked by stable entry id, not array index — a card's index can
  // shift (an earlier card removed) while this card's native folder
  // dialog is still open. Tracking by index would both misapply the
  // picked folder to whatever entry now occupies that index (possibly
  // a different terminal entirely) and leave the "busy" disabled state
  // stale for the card actually still browsing.
  const [browsingEntryId, setBrowsingEntryId] = useState<number | null>(null);

  async function handleBrowse(entryId: number): Promise<void> {
    setBrowsingEntryId(entryId);
    try {
      const selected = await window.api.selectProjectFolder();
      if (selected !== null) {
        // Re-resolve the entry's current index now, not the index at
        // the moment Browse was clicked — it may have shifted while
        // the dialog was open. If the entry was removed entirely in
        // the meantime, there's nothing left to apply this to.
        const currentIndex = entryIds.indexOf(entryId);
        if (currentIndex !== -1) {
          onChange({ terminals: updateTerminalEntry(params, currentIndex, { cwd: selected }) });
        }
      }
    } finally {
      setBrowsingEntryId(null);
    }
  }

  function handleAdd(): void {
    onChange({ terminals: addTerminalEntry(params) });
    setEntryIds((ids) => [...ids, nextEntryIdRef.current++]);
  }

  function handleRemove(index: number): void {
    onChange({ terminals: removeTerminalEntry(params, index) });
    setEntryIds((ids) => ids.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const entryId = entryIds[index] ?? index;
        return (
          <div
            key={entryId}
            className="flex flex-col gap-1.5 rounded-sm border border-border p-2.5"
          >
            <span className={FIELD_GROUP_LABEL_CLASS}>Working directory</span>
            <div className="flex items-center gap-1.5">
              <input
                className="h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
                type="text"
                placeholder="e.g. ~/projects/client-c"
                value={entry.cwd}
                onChange={(e) => {
                  onChange({ terminals: updateTerminalEntry(params, index, { cwd: e.target.value }) });
                }}
              />
              <button
                type="button"
                disabled={browsingEntryId === entryId}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-[12.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  void handleBrowse(entryId);
                }}
              >
                <Icon name="folder" size={12} />
                Browse…
              </button>
              <button
                type="button"
                aria-label={`Remove terminal ${index + 1}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-bg-hover hover:text-danger"
                onClick={() => {
                  handleRemove(index);
                }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className={FIELD_GROUP_LABEL_CLASS}>Commands</span>
              {(() => {
                // Never suggests a command already in this card's own
                // list — re-adding a duplicate wouldn't be useful.
                const suggestions = (recentCommands ?? []).filter(
                  (c) => !entry.commands.includes(c),
                );
                if (suggestions.length === 0) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-6 w-fit items-center gap-1.25 rounded-[5px] px-1.5 text-[11px] text-text-faint hover:bg-bg-hover hover:text-text-muted"
                      >
                        <Icon name="clock" size={11} />
                        Recent
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {suggestions.map((command) => (
                        <DropdownMenuItem
                          key={command}
                          title={command}
                          className="max-w-72 truncate font-mono text-[12px]"
                          onSelect={() => {
                            onChange({
                              terminals: updateTerminalEntry(params, index, {
                                commands: [...entry.commands, command],
                              }),
                            });
                          }}
                        >
                          {command}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
            </div>
            <EditableStringList
              values={entry.commands}
              onChange={(next) => {
                onChange({ terminals: updateTerminalEntry(params, index, { commands: next }) });
              }}
              placeholder="e.g. npm run dev"
              addLabel="Add command"
              removeAriaLabel={`Remove command from terminal ${index + 1}`}
              inputClassName="font-mono text-[12px]"
            />
          </div>
        );
      })}
      <button
        type="button"
        className="flex h-7 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-[11.5px] text-text-faint hover:border-text-faint hover:text-text-muted"
        onClick={handleAdd}
      >
        <Icon name="plus" size={11} />
        Add terminal
      </button>
    </div>
  );
}
