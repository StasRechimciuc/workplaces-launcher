/**
 * Per-workspace GLOBAL hotkey recording — distinct from lib/shortcuts.ts's
 * in-app shortcut system (purely renderer-side, event.key-based,
 * localStorage-persisted, never reaches the main process). A global
 * hotkey must survive to the OS level via Electron's globalShortcut in
 * the main process (hotkey-service.ts), so persistence/registration
 * live there — this file only owns turning a physical keydown into an
 * Electron accelerator string, using event.code (layout-independent),
 * never event.key (layout-dependent — wrong for an OS-level
 * accelerator; see ShortcutRow.tsx's own comboFromEvent, which uses
 * .key deliberately for its own, different, renderer-only purpose).
 */
import { isWellFormedAccelerator, switchAccelerator } from '@workspace-launcher/shared';

export { switchAccelerator };

const CODE_KEY_MAP: Record<string, string> = {
  ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [`Key${c}`, c])),
  ...Object.fromEntries('0123456789'.split('').map((d) => [`Digit${d}`, d])),
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
};

const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
]);

/**
 * Builds a base-combo accelerator from a physical keydown. Deliberately
 * never includes Shift — it's reserved for the derived Switch variant
 * (switchAccelerator above), so a held Shift is simply ignored here
 * rather than surfaced as part of the combo. Returns null while only a
 * modifier key is held so far, or the physical key has no accelerator
 * mapping — same "keep waiting" contract as ShortcutRow.tsx's
 * comboFromEvent.
 */
export function baseComboFromEvent(
  e: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  isMac: boolean,
): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const key = CODE_KEY_MAP[e.code];
  if (!key) return null;

  const tokens: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) tokens.push('CommandOrControl');
  // On mac, Control is a DISTINCT modifier from Cmd (Electron's own
  // accelerator vocabulary has both `CommandOrControl` and `Control`
  // tokens) — it was previously dropped entirely whenever held
  // alongside Cmd (e.g. ⌘⌃C silently registered as just ⌘C), since
  // `e.ctrlKey` was only ever consulted for CommandOrControl on
  // non-mac above. On Windows/Linux, ctrlKey already IS
  // CommandOrControl, so no separate token is needed there.
  if (isMac && e.ctrlKey) tokens.push('Control');
  if (e.altKey) tokens.push('Alt');
  if (tokens.length === 0) return null; // a global hotkey must have at least one modifier
  tokens.push(key);
  return tokens.join('+');
}

export function isValidBaseCombo(combo: string): boolean {
  return isWellFormedAccelerator(combo, { allowShift: false });
}
