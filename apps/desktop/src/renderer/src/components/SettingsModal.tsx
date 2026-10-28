import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccessibilityStatus } from '@workspace-launcher/shared';
import { Icon } from '../icons';
import { getStoredTheme, setStoredTheme, type Theme } from '../lib/theme';
import {
  DEFAULT_ACCENT_COLOR,
  getStoredAccentColor,
  resetAccentColor,
  setStoredAccentColor,
} from '../lib/accent-color';
import {
  SHORTCUTS,
  getEffectiveShortcuts,
  getStoredOverrides,
  resetAllShortcuts,
} from '../lib/shortcuts';
import { AppHotkeyControl } from './AppHotkeyControl';
import { ShortcutRow } from './ShortcutRow';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Owned by App.tsx (useAccessibilityStatus) — the same status the
   * reduced-mode banner reads, so the two can never disagree. */
  accessibilityStatus: AccessibilityStatus | null;
  /** Opens App.tsx's AccessibilityOnboardingModal — the same flow the
   * banner's "Set up" starts, not a second copy of it. */
  onOpenAccessibilityOnboarding: () => void;
}

/**
 * Built on DeleteWorkspaceConfirm.tsx's pattern (parent-owned `open`
 * prop, no internal open/closed state of its own). Theme (previously
 * its own Sidebar footer button — that button's own prior comment
 * already anticipated this: "a proper Settings surface can absorb this
 * control later") and Primary color are simple single-row preferences;
 * Shortcuts is the one titled sub-section, with its own `border-t`.
 */
export function SettingsModal({
  open,
  onClose,
  accessibilityStatus,
  onOpenAccessibilityOnboarding,
}: SettingsModalProps): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [accentColor, setAccentColor] = useState<string>(
    () => getStoredAccentColor() ?? DEFAULT_ACCENT_COLOR,
  );
  const [query, setQuery] = useState('');
  // Bumped on every shortcut change to force the effective-list memo
  // below to recompute — cheap, avoids needing a second state copy of
  // what lib/shortcuts.ts already owns in localStorage.
  const [version, setVersion] = useState(0);
  // Tracked outside React state (a ref, not useState) specifically so
  // reading it inside onEscapeKeyDown never needs a re-render to stay
  // current — see ShortcutRow.tsx's own comment on why a row's
  // stopPropagation() can't block Radix's Escape-to-close itself.
  const isRecordingRef = useRef(false);
  const isMac = window.api.platform === 'darwin';

  const effective = useMemo(
    () => getEffectiveShortcuts(SHORTCUTS, getStoredOverrides()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the deliberate invalidation signal; getStoredOverrides() itself isn't a dependency React can track.
    [version],
  );

  const filtered = useMemo(
    () => effective.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())),
    [effective, query],
  );

  const [launchOnLogin, setLaunchOnLoginState] = useState(false);
  const [launchOnLoginError, setLaunchOnLoginError] = useState('');

  // Re-read every time the modal opens — it's main-process state
  // (electron-store + the OS's own login-item registration), not
  // something this component can know changed otherwise.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.api.getLaunchOnLogin().then((result) => {
      if (cancelled) return;
      if (result.success) {
        setLaunchOnLoginState(result.enabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleToggleLaunchOnLogin(): Promise<void> {
    setLaunchOnLoginError('');
    const next = !launchOnLogin;
    const result = await window.api.setLaunchOnLogin(next);
    if (result.success) {
      setLaunchOnLoginState(next);
    } else {
      setLaunchOnLoginError(result.error);
    }
  }

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
  }

  function handleAccentColorChange(next: string): void {
    setStoredAccentColor(next);
    setAccentColor(next);
  }

  function handleResetAccentColor(): void {
    resetAccentColor();
    setAccentColor(DEFAULT_ACCENT_COLOR);
  }

  function refresh(): void {
    setVersion((v) => v + 1);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-120"
        onEscapeKeyDown={(e) => {
          // Blocks Radix's own dismiss-on-Escape while a row is
          // actively recording — a row's own stopPropagation() cannot
          // do this (see ShortcutRow.tsx's comment): Radix's dismiss
          // handling is a document-level capture-phase listener that
          // runs before any child's React handler ever sees the event.
          if (isRecordingRef.current) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text">
            <Icon name="x" size={14} />
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-text">Theme</span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong text-text-muted hover:bg-bg-hover hover:text-text"
              onClick={toggleTheme}
            >
              <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={14} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-text">Primary color</span>
            <div className="flex items-center gap-2">
              {accentColor !== DEFAULT_ACCENT_COLOR && (
                <button
                  type="button"
                  className="text-[11.5px] text-text-faint hover:text-text-muted"
                  onClick={handleResetAccentColor}
                >
                  Reset
                </button>
              )}
              <label
                className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border-strong"
                style={{ backgroundColor: accentColor }}
                title="Choose a primary color"
              >
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => {
                    handleAccentColorChange(e.target.value);
                  }}
                  aria-label="Primary color"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[12.5px] text-text">Launch at login</span>
              {/* No pre-emptive disabling in a dev build — that read as a
                  silently broken control (confirmed: its own explanatory
                  caption was too low-contrast to even notice on the light
                  theme). The toggle is always clickable; a dev-build
                  attempt to turn it ON is rejected server-side
                  (handlers.ts's setLaunchOnLogin) and shown here through
                  the same red-error-text path every other failed action
                  in this app already uses. */}
              {launchOnLoginError && (
                <span className="text-[11px] text-danger">{launchOnLoginError}</span>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={launchOnLogin}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                launchOnLogin ? 'bg-accent' : 'bg-bg-elevated'
              } border border-border-strong`}
              onClick={() => {
                void handleToggleLaunchOnLogin();
              }}
            >
              {/* A plain bg-white knob on this app's near-white light-theme
                  "off" track (bg-bg-elevated) was nearly invisible —
                  confirmed directly from a screenshot. A shadow gives the
                  knob a visible edge against ANY track color, in either
                  theme, rather than depending on a border/fill contrast
                  that only happened to work in dark mode. */}
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform ${
                  launchOnLogin ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* macOS only — hidden while unknown (null) or 'unsupported'.
              See WCs/WC__window-tracking.md, "Permissions". */}
          {accessibilityStatus && accessibilityStatus.state !== 'unsupported' && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-[12.5px] text-text">Accessibility</span>
                <span
                  className={`text-[11px] ${
                    accessibilityStatus.state === 'granted'
                      ? 'text-text-faint'
                      : accessibilityStatus.state === 'helper-unavailable'
                        ? 'text-danger'
                        : 'text-text-muted'
                  }`}
                >
                  {accessibilityStatus.state === 'granted'
                    ? 'Granted.'
                    : accessibilityStatus.state === 'not-granted'
                      ? 'Off — reduced mode: Close and Switch act on whole apps.'
                      : 'Window helper unavailable — reduced mode.'}
                </span>
              </div>
              {accessibilityStatus.state === 'not-granted' && (
                <button
                  type="button"
                  className="h-7 shrink-0 rounded-md border border-border-strong px-2.5 text-[11.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text"
                  onClick={onOpenAccessibilityOnboarding}
                >
                  Set up
                </button>
              )}
            </div>
          )}

          <div className="border-t border-border pt-4">
            <AppHotkeyControl isMac={isMac} />
          </div>

          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12.5px] font-semibold text-text">Shortcuts</h3>
              <button
                type="button"
                className="text-[11.5px] text-text-faint hover:text-text-muted"
                onClick={() => {
                  resetAllShortcuts();
                  refresh();
                }}
              >
                Reset all to defaults
              </button>
            </div>

            <div className="relative mb-2">
              <Icon
                name="search"
                size={13}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint"
              />
              <input
                className="h-8 w-full rounded-sm border border-border-strong bg-bg pl-8 pr-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
                type="text"
                placeholder="Search shortcuts…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              {filtered.map((s) => (
                <ShortcutRow
                  key={s.id}
                  shortcut={s}
                  effective={effective}
                  isMac={isMac}
                  onRecordingChange={(recording) => {
                    isRecordingRef.current = recording;
                  }}
                  onChanged={refresh}
                />
              ))}
              {filtered.length === 0 && (
                <p className="py-4 text-center text-[12px] text-text-faint">
                  No matching shortcuts.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
