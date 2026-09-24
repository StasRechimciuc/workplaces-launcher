import { describe, expect, it } from 'vitest';
import { getToolLogoSrc } from './tool-logos';

describe('getToolLogoSrc', () => {
  it('returns a BASE_URL-relative path for each real-logo tool type', () => {
    for (const type of ['vscode', 'spotify', 'chrome', 'clockify']) {
      const src = getToolLogoSrc(type);
      expect(src).toBe(`${import.meta.env.BASE_URL}tool-logos/${type}.svg`);
    }
  });

  it('returns undefined for a type with no real logo asset', () => {
    expect(getToolLogoSrc('docker')).toBeUndefined();
    expect(getToolLogoSrc('terminal')).toBeUndefined();
    expect(getToolLogoSrc('slack')).toBeUndefined();
    expect(getToolLogoSrc('nonexistent')).toBeUndefined();
  });
});
