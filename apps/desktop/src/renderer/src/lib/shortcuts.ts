/**
 * App-wide keyboard shortcut registry — a static list of definitions
 * (mirroring packages/shared/src/step-types.ts's STEP_TYPES convention:
 * a future feature adds an entry here, no runtime plugin-registration
 * system) plus user-override persistence, validation, conflict
 * detection, and display formatting.
 *
 * Persistence mirrors lib/theme.ts's exact existing pattern — plain
 * localStorage, not the main-process settings/store.ts (that store is
 * unwired dead code today, and this feature is a purely renderer-side
 * concern with no reason for the main process to know the current
 * bindings).
 */

export interface ShortcutDefinition {
  /** Namespaced, stable, never reused — e.g. "search.focus". */
  readonly id: string;
  /** Shown in Settings > Shortcuts. */
  readonly label: string;
  /** Settings groups by this even with one entry today. */
  readonly category: string;
  /** Electron accelerator-style token, e.g. "CommandOrControl+K". */
  readonly defaultCombo: string;
  /** Whether this shortcut should still fire while a text input/contenteditable has focus. */
  readonly allowInInput: boolean;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'search.focus',
    label: 'Focus search',
    category: 'General',
    defaultCombo: 'CommandOrControl+K',
    allowInInput: true,
  },
  {
    id: 'settings.open',
    label: 'Open settings',
    category: 'General',
    // The standard macOS Preferences convention — this app's own
    // Settings surface is exactly that, so this isn't "overriding" the
    // reserved meaning, it's fulfilling it. See MAC_RESERVED below:
    // Cmd+, is deliberately NOT on that list for this exact reason.
    defaultCombo: 'CommandOrControl+,',
    allowInInput: true,
  },
];

export type ShortcutOverrides = Record<string, string>;

const STORAGE_KEY = 'workspace-launcher:shortcuts';

/** Pure — validates/normalizes a raw stored value, defaulting to no
 * overrides for anything unparseable (never-set, invalid JSON, or not
 * a plain object). */
export function resolveStoredOverrides(raw: string | null): ShortcutOverrides {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ShortcutOverrides)
      : {};
  } catch {
    return {};
  }
}

/** Best-effort read — never throws. */
export function getStoredOverrides(): ShortcutOverrides {
  try {
    return resolveStoredOverrides(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Best-effort write — never throws. */
function writeOverrides(overrides: ShortcutOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Best-effort only, same as lib/theme.ts's setStoredTheme.
  }
}

export interface EffectiveShortcut extends ShortcutDefinition {
  readonly combo: string;
  readonly isCustomized: boolean;
}

/**
 * Merges defaults + persisted overrides. Iterates `definitions`, never
 * `overrides` — an override whose id has no matching definition (a
 * since-removed feature) is simply never read, left harmlessly in the
 * raw persisted JSON. IDs are never reused, so it can never resurrect
 * against an unrelated future feature; no active pruning needed.
 */
export function getEffectiveShortcuts(
  definitions: readonly ShortcutDefinition[],
  overrides: ShortcutOverrides,
): EffectiveShortcut[] {
  return definitions.map((def) => {
    const combo = overrides[def.id];
    return combo
      ? { ...def, combo, isCustomized: true }
      : { ...def, combo: def.defaultCombo, isCustomized: false };
  });
}

const MODIFIER_TOKENS = ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Meta'];

/** Sorts modifier tokens into a fixed order and uppercases the main
 * key, so e.g. "Shift+CommandOrControl+K" and "CommandOrControl+Shift+K"
 * compare equal. */
function normalizeCombo(combo: string): string {
  const tokens = combo.split('+').filter((t) => t.length > 0);
  const key = tokens[tokens.length - 1] ?? '';
  const modifiers = tokens
    .slice(0, -1)
    .filter((t) => MODIFIER_TOKENS.includes(t))
    .sort();
  return [...modifiers, key.toUpperCase()].join('+');
}

// macOS: Cmd+Q/W/Tab/Space/H/M (quit/close/app-switch/spotlight-ish/
// hide/minimize — OS- or app-activation-layer owned, never reliably
// reach a renderer keydown handler regardless of preventDefault()),
// Cmd+Shift+Q (also quit), Cmd+Shift+3/4/5 (screenshots). Cmd+, is
// deliberately NOT here — it's SHORTCUTS' own "settings.open" default,
// fulfilling the Preferences convention rather than violating it; the
// normal conflict-detection (findConflict) already stops any other
// shortcut from also claiming it.
const MAC_RESERVED = [
  'CommandOrControl+Q',
  'CommandOrControl+W',
  'CommandOrControl+Tab',
  'CommandOrControl+Space',
  'CommandOrControl+H',
  'CommandOrControl+M',
  'CommandOrControl+Shift+Q',
  'CommandOrControl+Shift+3',
  'CommandOrControl+Shift+4',
  'CommandOrControl+Shift+5',
].map(normalizeCombo);

const WIN_LINUX_RESERVED = ['Alt+Tab', 'Control+Alt+Delete', 'Alt+F4'].map(normalizeCombo);

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'no-modifier' | 'reserved'; message: string };

/** Pure — platform passed in rather than read internally, for testability. */
export function validateCombo(combo: string, isMac: boolean): ValidationResult {
  const tokens = combo.split('+').filter((t) => t.length > 0);
  const hasModifier = tokens.slice(0, -1).some((t) => MODIFIER_TOKENS.includes(t));
  if (!hasModifier) {
    return {
      valid: false,
      reason: 'no-modifier',
      message: isMac
        ? 'Shortcuts need a modifier key (⌘, ⌥, or ⇧).'
        : 'Shortcuts need a modifier key (Ctrl, Alt, or Shift).',
    };
  }

  const normalized = normalizeCombo(combo);
  const reserved = isMac ? MAC_RESERVED : WIN_LINUX_RESERVED;
  if (reserved.includes(normalized)) {
    return {
      valid: false,
      reason: 'reserved',
      message: `"${formatCombo(combo, isMac)}" is reserved by the system.`,
    };
  }

  return { valid: true };
}

/** Another shortcut already bound to the same (normalized) combo, if any. */
export function findConflict(
  combo: string,
  effective: readonly EffectiveShortcut[],
  excludeId: string,
): EffectiveShortcut | undefined {
  const target = normalizeCombo(combo);
  return effective.find((s) => s.id !== excludeId && normalizeCombo(s.combo) === target);
}

const MAC_GLYPHS: Record<string, string> = {
  CommandOrControl: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};
const WIN_LINUX_LABELS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Win',
};

/** The one shared formatter — Mac renders ⌘/⌥/⇧ glyphs with no "+"
 * joiner; Windows/Linux renders "Ctrl+"/"Alt+"/"Shift+" text. Every
 * display site (the search-box pill, the Settings > Shortcuts list)
 * must call this, never hardcode a glyph. */
export function formatCombo(combo: string, isMac: boolean): string {
  const tokens = combo.split('+').filter((t) => t.length > 0);
  const key = tokens[tokens.length - 1] ?? '';
  const modifiers = tokens.slice(0, -1);

  if (isMac) {
    return [...modifiers.map((m) => MAC_GLYPHS[m] ?? m), key.toUpperCase()].join('');
  }
  return [...modifiers.map((m) => WIN_LINUX_LABELS[m] ?? m), key.toUpperCase()].join('+');
}

export type SetOverrideResult =
  | { success: true }
  | { success: false; reason: 'no-modifier' | 'reserved' | 'conflict'; message: string };

/** Validates, checks for a conflict, and persists in one call — hard
 * blocks on either failure (founder's explicit choice over an
 * allow-with-overwrite pattern): never saves, never silently reassigns. */
export function setShortcutOverride(
  id: string,
  combo: string,
  effective: readonly EffectiveShortcut[],
  isMac: boolean,
): SetOverrideResult {
  const validation = validateCombo(combo, isMac);
  if (!validation.valid) {
    return { success: false, reason: validation.reason, message: validation.message };
  }

  const conflict = findConflict(combo, effective, id);
  if (conflict) {
    return { success: false, reason: 'conflict', message: `Already used by "${conflict.label}"` };
  }

  writeOverrides({ ...getStoredOverrides(), [id]: combo });
  return { success: true };
}

export function resetShortcut(id: string): void {
  const overrides = getStoredOverrides();
  const { [id]: _removed, ...rest } = overrides;
  writeOverrides(rest);
}

export function resetAllShortcuts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only.
  }
}
