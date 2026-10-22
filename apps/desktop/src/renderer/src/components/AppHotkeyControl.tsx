import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { formatCombo } from '../lib/shortcuts';
import { baseComboFromEvent, isValidBaseCombo } from '../lib/workspace-hotkeys';

interface AppHotkeyControlProps {
  isMac: boolean;
}

type ControlState = 'idle' | 'recording' | 'saving' | 'error';

// Same hung-IPC guard as WorkspaceHotkeyControl.tsx's identical constant.
const SAVE_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a response.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * The single, app-wide "Save current workspace" hotkey — lives in
 * Settings (unlike WorkspaceHotkeyControl.tsx, which was deliberately
 * moved OUT of Settings into Detail.tsx): this action has no single
 * workspace to be contextual to, so Settings is the natural home, not
 * a UX compromise.
 *
 * Shares `baseComboFromEvent`/`isValidBaseCombo` with the per-workspace
 * recorder, which means this control can never actually CAPTURE a
 * Shift-containing combo either (that utility always drops a held
 * Shift — it was built for the per-workspace recorder, where Shift is
 * structurally reserved for the derived Switch variant). The backend
 * (setAppHotkey) still accepts one if it ever arrives another way (a
 * hand-edited store file) — this is a defense-in-depth asymmetry, not
 * a bug: nothing requires the UI to offer every combo the backend
 * tolerates.
 */
export function AppHotkeyControl({ isMac }: AppHotkeyControlProps): JSX.Element {
  const [combo, setCombo] = useState<string | undefined>(undefined);
  const [needsRepick, setNeedsRepick] = useState(false);
  const [state, setState] = useState<ControlState>('idle');
  const [pendingCombo, setPendingCombo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.api.getAppHotkey(), window.api.getAppHotkeyFailed()]).then(
      ([binding, failed]) => {
        if (cancelled) return;
        setCombo(binding);
        setNeedsRepick(failed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function startRecording(): void {
    setState('recording');
    setErrorMsg('');
    setPendingCombo(null);
  }

  function exitToIdle(): void {
    setState('idle');
    setErrorMsg('');
    setPendingCombo(null);
  }

  async function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): Promise<void> {
    e.preventDefault();
    if (e.key === 'Escape') {
      exitToIdle();
      return;
    }

    const newCombo = baseComboFromEvent(e, isMac);
    if (!newCombo) {
      return; // only a modifier (or an unmapped key) so far — keep listening
    }
    if (!isValidBaseCombo(newCombo)) {
      setPendingCombo(newCombo);
      setState('error');
      setErrorMsg('Not a valid shortcut.');
      return;
    }

    setPendingCombo(newCombo);
    setState('saving');
    try {
      const result = await withTimeout(window.api.setAppHotkey(newCombo), SAVE_TIMEOUT_MS);
      if (result.success) {
        setCombo(newCombo);
        setNeedsRepick(false);
        exitToIdle();
      } else {
        setState('error');
        setErrorMsg(result.error);
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBlur(): void {
    if (state !== 'idle' && state !== 'saving') {
      exitToIdle();
    }
  }

  async function handleClear(): Promise<void> {
    await window.api.clearAppHotkey();
    setCombo(undefined);
    setNeedsRepick(false);
  }

  const showNeedsRepick = needsRepick && combo !== undefined;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-[12.5px] text-text">Save current workspace</span>
        <span className="text-[11px] text-text-faint">
          Detects what&rsquo;s currently open and builds a new workspace from it.
        </span>
      </div>

      {state !== 'idle' ? (
        <span className="flex flex-col items-end gap-1">
          <button
            type="button"
            autoFocus
            disabled={state === 'saving'}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.25 font-mono text-xs ${
              state === 'error'
                ? 'border-danger text-danger'
                : 'border-accent-border bg-accent-soft text-accent'
            }`}
            onKeyDown={(e) => {
              void handleKeyDown(e);
            }}
            onBlur={handleBlur}
          >
            {state === 'saving' ? (
              <Icon name="refresh" size={12} className="animate-spin" />
            ) : pendingCombo ? (
              formatCombo(pendingCombo, isMac)
            ) : (
              'Press keys…'
            )}
          </button>
          {state === 'error' && <span className="text-[11px] text-danger">{errorMsg}</span>}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1.25 text-xs text-text-muted">
          <Icon
            name="keyboard"
            size={12}
            className={showNeedsRepick ? 'text-danger' : 'text-text-faint'}
          />
          <button
            type="button"
            className="hover:text-text"
            onClick={startRecording}
            title={
              showNeedsRepick
                ? "Couldn't be re-registered with the OS — click to pick a different key."
                : undefined
            }
          >
            {combo ? formatCombo(combo, isMac) : 'Add hotkey'}
          </button>
          {combo && (
            <button
              type="button"
              className="text-text-faint hover:text-danger"
              onClick={() => {
                void handleClear();
              }}
              title="Remove hotkey"
            >
              <Icon name="x" size={10} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
