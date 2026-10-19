import { describe, expect, it } from 'vitest';
import { appDisplayName } from './app-display-name';

describe('appDisplayName', () => {
  it('strips the directory and .app suffix', () => {
    expect(appDisplayName('/Applications/Figma.app')).toBe('Figma');
  });

  it('strips only a trailing .app suffix, not one that happens to contain "app"', () => {
    expect(appDisplayName('/Applications/Keynote App.app')).toBe('Keynote App');
  });

  it('works for a nested system path', () => {
    expect(appDisplayName('/System/Applications/Music.app')).toBe('Music');
  });

  it('returns the whole string unchanged when there is no slash', () => {
    expect(appDisplayName('Figma.app')).toBe('Figma');
  });

  it('returns the base name unchanged when it has no .app suffix', () => {
    expect(appDisplayName('/Applications/Figma')).toBe('Figma');
  });
});
