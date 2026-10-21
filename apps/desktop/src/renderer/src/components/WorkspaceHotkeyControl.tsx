import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { formatCombo } from '../lib/shortcuts';
import { baseComboFromEvent, isValidBaseCombo, switchAccelerator } from '../lib/workspace-hotkeys';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';

interface WorkspaceHotkeyControlProps {
  workspaceId: string;
  isMac: boolean;
}

type ControlState = 'idle' | 'recording' | 'saving' | 'error';

// A hung or rejected IPC round trip must never leave this control
// stuck mid-recording with no way out besides Escape/blur — see
// WorkspaceHotkeyRow.tsx's (this component's predecessor, now removed
// — see WCs/WC__global-hotkeys.md's "moved out of Settings" note)
// identical reasoning.
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
 * Lives inline in Detail.tsx's metadata-pill row, next to "N tools" and
 * the launch-time pill — moved here from a dedicated Settings section
 * per direct founder feedback after using it ("its better to have the
 * hotkey under each ws instead of once in settings"): setting a
 * workspace's hotkey while you're already looking at that workspace is
 * more discoverable and contextual than hunting it down in a flat list
 * elsewhere. Fetches and owns its own binding state — Detail.tsx
 * doesn't need to know a hotkey exists at all.
 *
 * The Restore/Switch-via-Shift split and the "works even when closed"
 * behavior used to live ONLY in a hover title attribute — confirmed
 * (by direct founder feedback) to be effectively invisible: "we never
 * say anything abt shift." The info-icon popover below is the fix —
 * click, not hover, and it stays open until dismissed.
 */
export function WorkspaceHotkeyControl({
  workspaceId,
  isMac,
}: WorkspaceHotkeyControlProps): JSX.Element {
  const [combo, setCombo] = useState<string | undefined>(undefined);
  const [needsRepick, setNeedsRepick] = useState(false);
  const [state, setState] = useState<ControlState>('idle');
  const [pendingCombo, setPendingCombo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.api.getWorkspaceHotkey(workspaceId),
      window.api.getFailedWorkspaceHotkeys(),
    ]).then(([binding, failed]) => {
      if (cancelled) return;
      setCombo(binding);
      setNeedsRepick(failed.includes(workspaceId));
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

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
      const result = await withTimeout(
        window.api.setWorkspaceHotkey(workspaceId, newCombo),
        SAVE_TIMEOUT_MS,
      );
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
    await window.api.clearWorkspaceHotkey(workspaceId);
    setCombo(undefined);
    setNeedsRepick(false);
  }

  if (state !== 'idle') {
    return (
      <span className="flex flex-col items-start gap-1">
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
            'Press keys for Restore…'
          )}
        </button>
        {state === 'error' && <span className="text-[11px] text-danger">{errorMsg}</span>}
      </span>
    );
  }

  // Only meaningful alongside an actual combo — a stale/out-of-sync
  // failed-bindings snapshot (e.g. read a moment before this same
  // binding was cleared elsewhere) must never paint "needs re-picking"
  // red styling next to a plain, unset "Set hotkey" label.
  const showNeedsRepick = needsRepick && combo !== undefined;

  return (
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
        {combo ? (
          <>
            {formatCombo(combo, isMac)}{' '}
            <span className="text-text-faint">→ Restore</span>
          </>
        ) : (
          'Add hotkey'
        )}
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
      {/* A hover-only tooltip is how the Restore/Switch split (and the
          "works even when closed" part) went unnoticed in the first
          place — this is a click-to-open, stays-open explanation
          instead, always available right next to the control it
          explains rather than buried in a title attribute nobody
          hovers long enough to read. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="What does a hotkey do?"
            className="text-text-faint hover:text-text"
          >
            <Icon name="info" size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-3">
          <p className="text-[12px] leading-relaxed text-text">
            A keyboard shortcut for this workspace that works{' '}
            <strong className="text-text">anywhere on your Mac</strong> — even when Workspace
            Launcher isn&rsquo;t open.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-text">
            {combo ? (
              <>
                <span className="font-mono">{formatCombo(combo, isMac)}</span> restores this
                workspace. Add <strong className="text-text">Shift</strong> too (
                <span className="font-mono">
                  {formatCombo(switchAccelerator(combo), isMac)}
                </span>
                ) to switch to it instead and close all the other open apps.
              </>
            ) : (
              <>
                Pressing it restores this workspace. Hold{' '}
                <strong className="text-text">Shift</strong> too to switch to it instead and close all the other open apps.
              </>
            )}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
