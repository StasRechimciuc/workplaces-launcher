/**
 * Validates an Electron accelerator string this app is willing to
 * register as a global hotkey (main/orchestrator/hotkey-service.ts) —
 * imported by BOTH the renderer's recorder UI (a fast local check
 * before round-tripping to the main process) and the main process
 * itself (the actual source of truth, re-checked independently since a
 * binding could in principle reach `syncHotkeys()` from a hand-edited
 * `workspace-hotkeys` electron-store JSON file, not just the trusted
 * in-app recorder — see WCs/WC__global-hotkeys.md). Deliberately
 * conservative: one or more modifiers from a known set, plus exactly
 * one trailing key token from a known set — never a passthrough regex
 * that could construct an accelerator string Electron's own parser
 * hasn't been validated against.
 */

const ACCELERATOR_MODIFIERS = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Meta'] as const;
type AcceleratorModifier = (typeof ACCELERATOR_MODIFIERS)[number];

const ACCELERATOR_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  '`',
  '-',
  '=',
  '[',
  ']',
  '\\',
  ';',
  "'",
  ',',
  '.',
  '/',
]);

/**
 * Reserved out of a *base* hotkey combo — it's always appended
 * automatically to derive the Switch variant (switchAccelerator below).
 * A base combo containing it would make the derived Switch combo
 * ambiguous (a doubled modifier), and Electron's own accelerator parser
 * doesn't support that shape anyway.
 */
export const SWITCH_MODIFIER: AcceleratorModifier = 'Shift';

/**
 * `allowShift: true` is for validating an already-derived Switch combo
 * (which legitimately contains Shift); every other caller — recording
 * or persisting a *base* combo — uses the default `false`.
 */
export function isWellFormedAccelerator(
  combo: string,
  options: { allowShift?: boolean } = {},
): boolean {
  if (typeof combo !== 'string' || combo.length === 0) return false;

  const tokens = combo.split('+').filter((t) => t.length > 0);
  if (tokens.length < 2) return false; // at least one modifier + one key

  const key = tokens[tokens.length - 1]!;
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
  if (!ACCELERATOR_KEYS.has(normalizedKey)) return false;

  const modifiers = tokens.slice(0, -1);
  if (modifiers.length === 0) return false;
  if (new Set(modifiers).size !== modifiers.length) return false; // no duplicate modifier token
  if (!modifiers.every((m): m is AcceleratorModifier => ACCELERATOR_MODIFIERS.includes(m as AcceleratorModifier))) {
    return false;
  }
  if (!options.allowShift && modifiers.includes(SWITCH_MODIFIER)) return false;

  return true;
}

/**
 * The Switch-triggering variant of a recorded base accelerator — see
 * WCs/WC__global-hotkeys.md for why Shift (not Option/Control) is the
 * one reserved modifier.
 */
export function switchAccelerator(base: string): string {
  return `${base}+${SWITCH_MODIFIER}`;
}
