import { describe, expect, it } from 'vitest';
import { resolveStoredTheme } from './theme';

describe('resolveStoredTheme', () => {
  it('returns light for the stored value "light"', () => {
    expect(resolveStoredTheme('light')).toBe('light');
  });

  it('defaults to dark for null (never stored)', () => {
    expect(resolveStoredTheme(null)).toBe('dark');
  });

  it('defaults to dark for the literal "dark"', () => {
    expect(resolveStoredTheme('dark')).toBe('dark');
  });

  it('defaults to dark for any unrecognized value, not just the two valid ones', () => {
    // Forward-compat: a future version's value, a typo, or a hand-
    // edited localStorage entry should fail safe to this app's
    // original, only-ever-shipped behavior rather than throw or pick
    // an arbitrary theme.
    expect(resolveStoredTheme('Light')).toBe('dark');
    expect(resolveStoredTheme('')).toBe('dark');
    expect(resolveStoredTheme('system')).toBe('dark');
  });
});
