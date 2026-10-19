import { describe, expect, it } from 'vitest';
import { matchesCombo } from './useGlobalShortcuts';

function keyEvent(overrides: Partial<Parameters<typeof matchesCombo>[0]>): Parameters<typeof matchesCombo>[0] {
  return { key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe('matchesCombo', () => {
  it('CommandOrControl matches metaKey on Mac, not ctrlKey', () => {
    expect(matchesCombo(keyEvent({ key: 'k', metaKey: true }), 'CommandOrControl+K', true)).toBe(true);
    expect(matchesCombo(keyEvent({ key: 'k', ctrlKey: true }), 'CommandOrControl+K', true)).toBe(false);
  });

  it('CommandOrControl matches ctrlKey on Windows/Linux, not metaKey', () => {
    expect(matchesCombo(keyEvent({ key: 'k', ctrlKey: true }), 'CommandOrControl+K', false)).toBe(true);
    expect(matchesCombo(keyEvent({ key: 'k', metaKey: true }), 'CommandOrControl+K', false)).toBe(false);
  });

  it('regression: never matches via "metaKey || ctrlKey" — the two are never conflated', () => {
    // Real Ctrl+K pressed on Mac must never satisfy a CommandOrControl+K
    // (i.e. real Cmd+K) binding, and vice versa on Windows/Linux.
    expect(matchesCombo(keyEvent({ key: 'k', ctrlKey: true, metaKey: false }), 'CommandOrControl+K', true)).toBe(false);
    expect(matchesCombo(keyEvent({ key: 'k', metaKey: true, ctrlKey: false }), 'CommandOrControl+K', false)).toBe(false);
  });

  it('requires an exact modifier set — an extra, unlisted modifier does not match', () => {
    // Cmd+Shift+K must not match a plain CommandOrControl+K binding.
    expect(
      matchesCombo(keyEvent({ key: 'k', metaKey: true, shiftKey: true }), 'CommandOrControl+K', true),
    ).toBe(false);
    expect(
      matchesCombo(keyEvent({ key: 'k', metaKey: true, altKey: true }), 'CommandOrControl+K', true),
    ).toBe(false);
  });

  it('matches a multi-modifier combo only when every listed modifier is present', () => {
    expect(
      matchesCombo(
        keyEvent({ key: 'k', metaKey: true, shiftKey: true }),
        'CommandOrControl+Shift+K',
        true,
      ),
    ).toBe(true);
    expect(
      matchesCombo(keyEvent({ key: 'k', metaKey: true }), 'CommandOrControl+Shift+K', true),
    ).toBe(false);
  });

  it('matches the key case-insensitively (Shift/Caps Lock affecting e.key casing)', () => {
    expect(matchesCombo(keyEvent({ key: 'K', metaKey: true }), 'CommandOrControl+K', true)).toBe(true);
    expect(matchesCombo(keyEvent({ key: 'k', metaKey: true }), 'CommandOrControl+k', true)).toBe(true);
  });

  it('does not match an unrelated key even with the correct modifiers', () => {
    expect(matchesCombo(keyEvent({ key: 'j', metaKey: true }), 'CommandOrControl+K', true)).toBe(false);
  });
});
