import { describe, expect, it } from 'vitest';
import { resolveStoredAccentColor } from './accent-color';

describe('resolveStoredAccentColor', () => {
  it('returns the stored value, lowercased, for a valid 6-digit hex color', () => {
    expect(resolveStoredAccentColor('#3b6cf0')).toBe('#3b6cf0');
    expect(resolveStoredAccentColor('#3B6CF0')).toBe('#3b6cf0');
  });

  it('defaults to null (no override — styles.css\'s own default applies) for null (never stored)', () => {
    expect(resolveStoredAccentColor(null)).toBeNull();
  });

  it('defaults to null for any value that is not a valid 6-digit hex color', () => {
    // Forward-compat: a future version's value, a typo, or a hand-
    // edited localStorage entry should fail safe to this app's shipped
    // default rather than throw or apply a garbage/partial color.
    expect(resolveStoredAccentColor('')).toBeNull();
    expect(resolveStoredAccentColor('not-a-color')).toBeNull();
    expect(resolveStoredAccentColor('#fff')).toBeNull(); // 3-digit shorthand, not accepted
    expect(resolveStoredAccentColor('#3b6cf')).toBeNull(); // too short
    expect(resolveStoredAccentColor('#3b6cf00')).toBeNull(); // too long
    expect(resolveStoredAccentColor('3b6cf0')).toBeNull(); // missing #
    expect(resolveStoredAccentColor('rgb(59, 108, 240)')).toBeNull();
  });
});
