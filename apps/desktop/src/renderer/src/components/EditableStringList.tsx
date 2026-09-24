import { useRef, useState } from 'react';
import { Icon } from '../icons';
import { cn } from '../lib/utils';

interface EditableStringListProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeAriaLabel: string;
  inputClassName?: string;
}

/**
 * A list of individually editable, removable, appendable text rows —
 * shared by vscode-fields.tsx's terminal commands and chrome-fields.tsx's
 * URLs (previously near-duplicated UI in both files).
 *
 * Keys each row by a locally-generated stable id (a counter, same
 * pattern as WorkspaceFormModal.tsx's CreateStepDraft.key — see its own
 * doc comment), never by array index. An index key would let React
 * reconcile the wrong DOM node onto a shifted row after removing an
 * earlier one — the row that used to hold keyboard focus gets destroyed
 * while a *different* row silently inherits its old key, dropping focus
 * to <body> with no visible cause. `rowIds` and `values` are always
 * mutated together, in lockstep, by this component's own three
 * handlers — nothing external ever changes `values`' length out from
 * under it (the parent only ever replaces the whole params object when
 * this exact row unmounts, which resets this component's local state
 * along with it).
 */
export function EditableStringList({
  values,
  onChange,
  placeholder,
  addLabel,
  removeAriaLabel,
  inputClassName,
}: EditableStringListProps): JSX.Element {
  const nextRowIdRef = useRef(0);
  const [rowIds, setRowIds] = useState<number[]>(() => values.map(() => nextRowIdRef.current++));

  function updateAt(index: number, value: string): void {
    onChange(values.map((v, i) => (i === index ? value : v)));
  }

  function removeAt(index: number): void {
    onChange(values.filter((_, i) => i !== index));
    setRowIds((ids) => ids.filter((_, i) => i !== index));
  }

  function add(): void {
    onChange([...values, '']);
    setRowIds((ids) => [...ids, nextRowIdRef.current++]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1.25">
        {values.map((value, index) => (
          <div className="flex items-center gap-1.5" key={rowIds[index] ?? index}>
            <input
              className={cn(
                'h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none',
                inputClassName,
              )}
              type="text"
              placeholder={placeholder}
              value={value}
              onChange={(e) => {
                updateAt(index, e.target.value);
              }}
            />
            <button
              type="button"
              aria-label={removeAriaLabel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-text-faint hover:bg-bg-active hover:text-text"
              onClick={() => {
                removeAt(index);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="flex h-7 items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-[11.5px] text-text-faint hover:border-text-faint hover:text-text-muted"
        onClick={add}
      >
        <Icon name="plus" size={11} />
        {addLabel}
      </button>
    </div>
  );
}
