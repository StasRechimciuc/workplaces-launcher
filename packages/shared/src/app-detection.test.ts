import { describe, expect, it } from 'vitest';
import { isToolAppKey, TOOL_APP_KEYS } from './app-detection';

describe('isToolAppKey', () => {
  it.each(TOOL_APP_KEYS)('returns true for %s', (key) => {
    expect(isToolAppKey(key)).toBe(true);
  });

  it('returns false for an unrelated step type', () => {
    expect(isToolAppKey('docker')).toBe(false);
    expect(isToolAppKey('app')).toBe(false);
  });

  it('returns false for a non-string value', () => {
    expect(isToolAppKey(123)).toBe(false);
    expect(isToolAppKey(undefined)).toBe(false);
    expect(isToolAppKey(null)).toBe(false);
  });
});
