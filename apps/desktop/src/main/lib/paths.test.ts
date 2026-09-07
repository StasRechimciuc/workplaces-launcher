import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandHome } from './paths';

describe('expandHome', () => {
  it('expands a bare "~" to the home directory', () => {
    expect(expandHome('~')).toBe(homedir());
  });

  it('expands "~/..." to a path under the home directory', () => {
    expect(expandHome('~/projects/client-a')).toBe(join(homedir(), 'projects/client-a'));
  });

  it('leaves an already-absolute path unchanged', () => {
    expect(expandHome('/Users/me/projects/client-a')).toBe('/Users/me/projects/client-a');
  });

  it('leaves a path containing "~" but not starting with it unchanged', () => {
    // Not a home-directory reference — e.g. a literal folder named "~foo".
    expect(expandHome('/tmp/~foo')).toBe('/tmp/~foo');
  });
});
