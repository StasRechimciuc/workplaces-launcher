import { describe, expect, it } from 'vitest';
import { baseComboFromEvent, isValidBaseCombo, switchAccelerator } from './workspace-hotkeys';

function keyDown(
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
): { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean } {
  return { code, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt };
}

describe('baseComboFromEvent', () => {
  it('returns null while only a modifier key is held', () => {
    expect(baseComboFromEvent(keyDown('MetaLeft', { meta: true }), true)).toBeNull();
    expect(baseComboFromEvent(keyDown('ShiftLeft'), true)).toBeNull();
  });

  it('returns null for a key with no accelerator mapping', () => {
    expect(baseComboFromEvent(keyDown('NumpadEnter', { meta: true }), true)).toBeNull();
  });

  it('returns null when no modifier is held at all', () => {
    expect(baseComboFromEvent(keyDown('KeyA'), true)).toBeNull();
  });

  it('builds CommandOrControl from metaKey on mac, ctrlKey elsewhere', () => {
    expect(baseComboFromEvent(keyDown('KeyA', { meta: true }), true)).toBe('CommandOrControl+A');
    expect(baseComboFromEvent(keyDown('KeyA', { ctrl: true }), false)).toBe('CommandOrControl+A');
  });

  it('adds Alt when held', () => {
    expect(baseComboFromEvent(keyDown('Digit1', { meta: true, alt: true }), true)).toBe(
      'CommandOrControl+Alt+1',
    );
  });

  it('captures a literal Control held alongside Cmd on mac as its own distinct modifier', () => {
    // Regression: Control was previously dropped entirely whenever held
    // alongside Cmd on mac — pressing Cmd+Ctrl+C silently registered as
    // just Cmd+C, since ctrlKey was only ever consulted for
    // CommandOrControl on non-mac.
    expect(baseComboFromEvent(keyDown('KeyC', { meta: true, ctrl: true }), true)).toBe(
      'CommandOrControl+Control+C',
    );
  });

  it('captures a bare Control (no Cmd) on mac too', () => {
    expect(baseComboFromEvent(keyDown('KeyC', { ctrl: true }), true)).toBe('Control+C');
  });

  it('does not double up Control on non-mac, where ctrlKey already maps to CommandOrControl', () => {
    expect(baseComboFromEvent(keyDown('KeyC', { ctrl: true }), false)).toBe('CommandOrControl+C');
  });

  it('never includes Shift even if held — reserved for the derived Switch variant', () => {
    // baseComboFromEvent's signature deliberately has no shiftKey param
    // at all — a held Shift simply cannot reach the built combo.
    expect(baseComboFromEvent(keyDown('KeyA', { meta: true }), true)).toBe('CommandOrControl+A');
  });

  it('maps function keys and punctuation codes correctly', () => {
    expect(baseComboFromEvent(keyDown('F5', { meta: true }), true)).toBe('CommandOrControl+F5');
    expect(baseComboFromEvent(keyDown('Comma', { meta: true }), true)).toBe('CommandOrControl+,');
  });
});

describe('isValidBaseCombo', () => {
  it('accepts a well-formed base combo', () => {
    expect(isValidBaseCombo('CommandOrControl+Alt+1')).toBe(true);
  });

  it('rejects a combo containing Shift', () => {
    expect(isValidBaseCombo('CommandOrControl+Shift+1')).toBe(false);
  });

  it('rejects a combo with no modifier', () => {
    expect(isValidBaseCombo('A')).toBe(false);
  });
});

describe('switchAccelerator', () => {
  it('appends the reserved Shift modifier to the base combo', () => {
    expect(switchAccelerator('CommandOrControl+Alt+1')).toBe('CommandOrControl+Alt+1+Shift');
  });
});
