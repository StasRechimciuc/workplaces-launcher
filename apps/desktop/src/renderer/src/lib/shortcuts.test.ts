import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  findConflict,
  formatCombo,
  getEffectiveShortcuts,
  resetAllShortcuts,
  resetShortcut,
  resolveStoredOverrides,
  setShortcutOverride,
  validateCombo,
  type EffectiveShortcut,
} from './shortcuts';

describe('resolveStoredOverrides', () => {
  it('returns an empty object for null (never set)', () => {
    expect(resolveStoredOverrides(null)).toEqual({});
  });

  it('returns an empty object for invalid JSON', () => {
    expect(resolveStoredOverrides('{ not json')).toEqual({});
  });

  it('returns an empty object for valid JSON that is not a plain object', () => {
    expect(resolveStoredOverrides('42')).toEqual({});
    expect(resolveStoredOverrides('"a string"')).toEqual({});
    expect(resolveStoredOverrides('[1,2,3]')).toEqual({});
    expect(resolveStoredOverrides('null')).toEqual({});
  });

  it('returns the parsed object for valid stored overrides', () => {
    expect(resolveStoredOverrides('{"search.focus":"CommandOrControl+J"}')).toEqual({
      'search.focus': 'CommandOrControl+J',
    });
  });
});

describe('getEffectiveShortcuts', () => {
  const defs = [
    { id: 'a', label: 'A', category: 'General', defaultCombo: 'CommandOrControl+A', allowInInput: false },
    { id: 'b', label: 'B', category: 'General', defaultCombo: 'CommandOrControl+B', allowInInput: false },
  ];

  it('uses the default combo and isCustomized:false when there is no override', () => {
    expect(getEffectiveShortcuts(defs, {})).toEqual([
      { ...defs[0], combo: 'CommandOrControl+A', isCustomized: false },
      { ...defs[1], combo: 'CommandOrControl+B', isCustomized: false },
    ]);
  });

  it('uses the override combo and isCustomized:true when one exists', () => {
    const result = getEffectiveShortcuts(defs, { a: 'CommandOrControl+Z' });
    expect(result[0]).toEqual({ ...defs[0], combo: 'CommandOrControl+Z', isCustomized: true });
    expect(result[1]).toEqual({ ...defs[1], combo: 'CommandOrControl+B', isCustomized: false });
  });

  it('silently ignores an override whose id has no matching definition (orphan)', () => {
    const result = getEffectiveShortcuts(defs, { 'removed.feature': 'CommandOrControl+X' });
    expect(result).toEqual([
      { ...defs[0], combo: 'CommandOrControl+A', isCustomized: false },
      { ...defs[1], combo: 'CommandOrControl+B', isCustomized: false },
    ]);
  });
});

describe('validateCombo', () => {
  it('rejects a combo with no modifier, on both platforms', () => {
    expect(validateCombo('K', true)).toEqual({
      valid: false,
      reason: 'no-modifier',
      message: expect.stringContaining('modifier'),
    });
    expect(validateCombo('K', false)).toMatchObject({ valid: false, reason: 'no-modifier' });
  });

  it('rejects each macOS-reserved combo', () => {
    for (const combo of ['CommandOrControl+Q', 'CommandOrControl+W', 'CommandOrControl+Tab']) {
      expect(validateCombo(combo, true)).toMatchObject({ valid: false, reason: 'reserved' });
    }
  });

  it('does not reject Cmd+, — it is settings.open\'s own default, not an unimplemented OS convention', () => {
    expect(validateCombo('CommandOrControl+,', true)).toEqual({ valid: true });
  });

  it('rejects each Windows/Linux-reserved combo', () => {
    for (const combo of ['Alt+Tab', 'Control+Alt+Delete', 'Alt+F4']) {
      expect(validateCombo(combo, false)).toMatchObject({ valid: false, reason: 'reserved' });
    }
  });

  it('accepts a valid, non-reserved combo with a modifier', () => {
    expect(validateCombo('CommandOrControl+J', true)).toEqual({ valid: true });
    expect(validateCombo('CommandOrControl+Shift+J', false)).toEqual({ valid: true });
  });

  it('a mac-reserved combo is not rejected on Windows/Linux and vice versa', () => {
    expect(validateCombo('CommandOrControl+Q', false)).toEqual({ valid: true });
    expect(validateCombo('Alt+Tab', true)).toEqual({ valid: true });
  });
});

describe('findConflict', () => {
  const effective: EffectiveShortcut[] = [
    { id: 'a', label: 'A', category: 'General', defaultCombo: 'CommandOrControl+A', allowInInput: false, combo: 'CommandOrControl+A', isCustomized: false },
    { id: 'b', label: 'B', category: 'General', defaultCombo: 'CommandOrControl+B', allowInInput: false, combo: 'CommandOrControl+B', isCustomized: false },
  ];

  it('finds a collision with another shortcut', () => {
    expect(findConflict('CommandOrControl+B', effective, 'a')).toEqual(effective[1]);
  });

  it('excludes the shortcut being edited itself', () => {
    expect(findConflict('CommandOrControl+A', effective, 'a')).toBeUndefined();
  });

  it('returns undefined when the combo is free', () => {
    expect(findConflict('CommandOrControl+Z', effective, 'a')).toBeUndefined();
  });

  it('treats differently-ordered modifier tokens as the same combo', () => {
    const withShift: EffectiveShortcut[] = [
      { id: 'c', label: 'C', category: 'General', defaultCombo: 'Shift+CommandOrControl+K', allowInInput: false, combo: 'Shift+CommandOrControl+K', isCustomized: false },
    ];
    expect(findConflict('CommandOrControl+Shift+K', withShift, 'other')).toEqual(withShift[0]);
  });
});

describe('formatCombo', () => {
  it('renders Mac glyphs with no "+" joiner', () => {
    expect(formatCombo('CommandOrControl+K', true)).toBe('⌘K');
    expect(formatCombo('CommandOrControl+Shift+K', true)).toBe('⌘⇧K');
  });

  it('renders Windows/Linux text with "+" joiners', () => {
    expect(formatCombo('CommandOrControl+K', false)).toBe('Ctrl+K');
    expect(formatCombo('CommandOrControl+Shift+K', false)).toBe('Ctrl+Shift+K');
  });
});

// setShortcutOverride/resetShortcut/resetAllShortcuts all touch real
// localStorage internally, which — like lib/theme.ts's getStoredTheme/
// setStoredTheme — isn't available under this project's Vitest
// environment (environment: 'node', confirmed via vitest.config.ts; no
// jsdom). Following theme.test.ts's own established precedent: test the
// orchestration logic's return value (validate -> conflict-check,
// which never touches localStorage on a rejection path) rather than
// asserting on an actual persisted round trip.
describe('setShortcutOverride', () => {
  const effective: EffectiveShortcut[] = getEffectiveShortcuts(SHORTCUTS, {});

  it('returns success:true for a valid, non-conflicting combo', () => {
    const result = setShortcutOverride('search.focus', 'CommandOrControl+J', effective, true);
    expect(result).toEqual({ success: true });
  });

  it('returns a no-modifier failure for an invalid combo, before ever attempting to persist', () => {
    const result = setShortcutOverride('search.focus', 'J', effective, true);
    expect(result).toMatchObject({ success: false, reason: 'no-modifier' });
  });

  it('returns a conflict failure naming the colliding shortcut', () => {
    const withConflict: EffectiveShortcut[] = [
      ...effective,
      {
        id: 'other.action',
        label: 'Other action',
        category: 'General',
        defaultCombo: 'CommandOrControl+J',
        allowInInput: false,
        combo: 'CommandOrControl+J',
        isCustomized: false,
      },
    ];
    const result = setShortcutOverride('search.focus', 'CommandOrControl+J', withConflict, true);
    expect(result).toEqual({
      success: false,
      reason: 'conflict',
      message: 'Already used by "Other action"',
    });
  });
});

describe('resetShortcut / resetAllShortcuts', () => {
  it('never throw, even with no real localStorage backing them (best-effort access)', () => {
    expect(() => {
      resetShortcut('search.focus');
    }).not.toThrow();
    expect(() => {
      resetAllShortcuts();
    }).not.toThrow();
  });
});
