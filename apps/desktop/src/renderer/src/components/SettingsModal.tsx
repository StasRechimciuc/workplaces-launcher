import { useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { getStoredTheme, setStoredTheme, type Theme } from '../lib/theme';
import {
  SHORTCUTS,
  getEffectiveShortcuts,
  getStoredOverrides,
  resetAllShortcuts,
} from '../lib/shortcuts';
import { ShortcutRow } from './ShortcutRow';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Built on DeleteWorkspaceConfirm.tsx's pattern (parent-owned `open`
 * prop, no internal open/closed state of its own). First (and for now
 * only) section is Shortcuts — the Theme toggle, previously its own
 * Sidebar footer button, moved in here as this surface's first real
 * preference row (that button's own prior comment already anticipated
 * this: "a proper Settings surface can absorb this control later").
 */
export function SettingsModal({ open, onClose }: SettingsModalProps): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
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

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
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
