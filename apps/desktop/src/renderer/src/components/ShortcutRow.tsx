import { useState } from 'react';
import {
  formatCombo,
  resetShortcut,
  setShortcutOverride,
  type EffectiveShortcut,
} from '../lib/shortcuts';

interface ShortcutRowProps {
  shortcut: EffectiveShortcut;
  effective: readonly EffectiveShortcut[];
  isMac: boolean;
  /** Lets the parent block Radix's own Escape-closes-the-dialog while
   * this row is actively recording — see SettingsModal.tsx's
   * `onEscapeKeyDown`. A row's own `stopPropagation()` cannot do this:
   * Radix's dismiss handling is a document-level CAPTURE-phase
   * listener, which fires before any child's React handler ever sees
   * the event. */
  onRecordingChange: (recording: boolean) => void;
  onChanged: () => void;
}

type RowState = 'idle' | 'recording' | 'error';

const BUTTON_CLASS =
  'flex h-7 min-w-20 items-center justify-center rounded-sm border border-border-strong px-2.5 font-mono text-[11.5px] text-text-muted hover:border-text-faint';
const RECORDING_CLASS =
  'flex h-7 min-w-20 items-center justify-center rounded-sm border border-accent-border bg-accent-soft px-2.5 font-mono text-[11.5px] text-accent';
const ERROR_CLASS =
  'flex h-7 min-w-20 items-center justify-center rounded-sm border border-danger px-2.5 font-mono text-[11.5px] text-danger';

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);

function comboFromEvent(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, isMac: boolean): string | null {
  if (MODIFIER_KEYS.has(e.key)) {
    return null; // still waiting for the actual non-modifier key
  }
  const tokens: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) tokens.push('CommandOrControl');
  if (e.altKey) tokens.push('Alt');
  if (e.shiftKey) tokens.push('Shift');
  tokens.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return tokens.join('+');
}

export function ShortcutRow({
  shortcut,
  effective,
  isMac,
  onRecordingChange,
  onChanged,
}: ShortcutRowProps): JSX.Element {
  const [state, setState] = useState<RowState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingCombo, setPendingCombo] = useState<string | null>(null);

  function startRecording(): void {
    setState('recording');
    setErrorMsg('');
    setPendingCombo(null);
    onRecordingChange(true);
  }

  function exitRecording(): void {
    setState('idle');
    setErrorMsg('');
    setPendingCombo(null);
    onRecordingChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    e.preventDefault();
    if (e.key === 'Escape') {
      exitRecording();
      return;
    }

    const combo = comboFromEvent(e, isMac);
    if (!combo) {
      return; // only a modifier was pressed so far — keep listening
    }

    setPendingCombo(combo);
    const result = setShortcutOverride(shortcut.id, combo, effective, isMac);
    if (result.success) {
      exitRecording();
      onChanged();
    } else {
      setState('error');
      setErrorMsg(result.message);
      // Stay listening — the field remains focused so the user can try
      // another combo without re-clicking; only Escape or blur exits.
    }
  }

  function handleBlur(): void {
    if (state !== 'idle') {
      exitRecording();
    }
  }

  function handleReset(): void {
    resetShortcut(shortcut.id);
    onChanged();
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 hover:bg-bg-hover">
      <span className="text-[12.5px] text-text">{shortcut.label}</span>
      <div className="flex items-center gap-1.5">
        {shortcut.isCustomized && state === 'idle' && (
          <button
            type="button"
            className="text-[11px] text-text-faint hover:text-text-muted"
            onClick={handleReset}
          >
            Reset
          </button>
        )}

        {state === 'idle' ? (
          <button type="button" className={BUTTON_CLASS} onClick={startRecording}>
            {formatCombo(shortcut.combo, isMac)}
          </button>
        ) : (
          // One stable element across recording <-> error, not two
          // conditionally-mounted buttons — swapping elements on that
          // transition would unmount the focused recording button,
          // which fires a native blur during React's commit (after
          // handleKeyDown already returned), re-entering handleBlur
          // with a stale closure and incorrectly exiting back to idle
          // right as the error was meant to show.
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              autoFocus
              className={state === 'error' ? ERROR_CLASS : RECORDING_CLASS}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
            >
              {state === 'error' && pendingCombo ? formatCombo(pendingCombo, isMac) : 'Press keys…'}
            </button>
            {state === 'error' && <span className="text-[11px] text-danger">{errorMsg}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
