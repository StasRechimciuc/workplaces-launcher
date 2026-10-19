import { useEffect } from 'react';
import { SHORTCUTS, getEffectiveShortcuts, getStoredOverrides } from './shortcuts';

/**
 * Pure — whether a keydown event satisfies a stored combo token (e.g.
 * "CommandOrControl+K"). Takes a minimal event shape so it's testable
 * without a real KeyboardEvent.
 *
 * Two correctness points, both caught in review before this shipped:
 * - Never `e.metaKey || e.ctrlKey` — Cmd and Ctrl are distinct, separate
 *   modifiers on every platform (Windows' metaKey is the Windows/Super
 *   key, not Ctrl). CommandOrControl resolves to exactly one real key
 *   per platform: metaKey on Mac, ctrlKey elsewhere.
 * - Exact modifier set, not just "the required ones are present" — a
 *   combo bound to CommandOrControl+K must NOT also match
 *   CommandOrControl+Shift+K; every modifier flag is checked, including
 *   ones the combo does NOT list.
 */
export function matchesCombo(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  combo: string,
  isMac: boolean,
): boolean {
  const tokens = combo.split('+').filter((t) => t.length > 0);
  const key = tokens[tokens.length - 1] ?? '';
  const wantsPrimary = tokens.includes('CommandOrControl') || tokens.includes('Control');
  const wantsAlt = tokens.includes('Alt');
  const wantsShift = tokens.includes('Shift');

  const primaryPressed = isMac ? e.metaKey : e.ctrlKey;
  if (primaryPressed !== wantsPrimary) return false;
  if (e.altKey !== wantsAlt) return false;
  if (e.shiftKey !== wantsShift) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

/**
 * Attaches one app-wide keydown listener dispatching to whichever
 * registered shortcut's combo matches, skipping shortcuts not marked
 * `allowInInput` while a text input/contenteditable has focus.
 *
 * The effective shortcut map is recomputed fresh inside the handler on
 * every keydown, not cached in the effect closure — a rebind made via
 * the Settings modal while the app stays open must take effect
 * immediately, not depend on this effect happening to re-run for an
 * unrelated reason (caught in review: `handlers` being a fresh object
 * literal on every render made this "accidentally" work before, a
 * fragile coupling that a future `useMemo` on `handlers` would have
 * silently broken).
 */
export function useGlobalShortcuts(handlers: Record<string, () => void>): void {
  const isMac = window.api.platform === 'darwin';

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const effective = getEffectiveShortcuts(SHORTCUTS, getStoredOverrides());
      const target = document.activeElement;
      const isTextInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      for (const shortcut of effective) {
        if (isTextInput && !shortcut.allowInInput) continue;
        const handler = handlers[shortcut.id];
        if (handler && matchesCombo(e, shortcut.combo, isMac)) {
          e.preventDefault();
          handler();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handlers, isMac]);
}
