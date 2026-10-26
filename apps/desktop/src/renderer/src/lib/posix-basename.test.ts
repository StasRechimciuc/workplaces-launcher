import { describe, expect, it } from 'vitest';
import { posixBasename } from './posix-basename';

describe('posixBasename', () => {
  it('returns the final path segment', () => {
    expect(posixBasename('/Users/stas/projects/my-app')).toBe('my-app');
  });

  it('strips a trailing slash before extracting the segment', () => {
    expect(posixBasename('/Users/stas/projects/my-app/')).toBe('my-app');
  });

  it('strips multiple trailing slashes', () => {
    expect(posixBasename('/Users/stas/projects/my-app///')).toBe('my-app');
  });

  it('returns an empty string for an empty or root-only path', () => {
    expect(posixBasename('')).toBe('');
    expect(posixBasename('/')).toBe('');
  });

  it('returns the path itself when it has no slash', () => {
    expect(posixBasename('my-app')).toBe('my-app');
  });
});
