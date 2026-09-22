import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandHome, isAcceptableToolPath } from './paths';

const originalPlatform = process.platform;

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

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

  it('expands "~\\..." (backslash) to a path under the home directory on win32', () => {
    stubPlatform('win32');
    expect(expandHome('~\\projects\\client-a')).toBe(join(homedir(), 'projects\\client-a'));
  });

  it('still expands "~/..." (forward slash) on win32', () => {
    stubPlatform('win32');
    expect(expandHome('~/projects/client-a')).toBe(join(homedir(), 'projects/client-a'));
  });

  it('does not treat "~\\..." as a home reference on non-win32 platforms', () => {
    stubPlatform('darwin');
    // A literal, if unusual, POSIX filename — must not be reinterpreted.
    expect(expandHome('~\\projects\\client-a')).toBe('~\\projects\\client-a');
  });
});

describe('isAcceptableToolPath', () => {
  it('accepts a bare "~"', () => {
    expect(isAcceptableToolPath('~')).toBe(true);
  });

  it('accepts "~/..."', () => {
    expect(isAcceptableToolPath('~/projects/client-a')).toBe(true);
  });

  it('accepts an already-absolute POSIX path', () => {
    stubPlatform('darwin');
    expect(isAcceptableToolPath('/Users/me/projects/client-a')).toBe(true);
  });

  it('rejects a bare relative path', () => {
    // The concrete bug this guards against: a relative path hashes to
    // a different file than the VS Code extension's absolute
    // folder.uri.fsPath ever will, so terminal restore silently never
    // fires — and the folder itself may open from an unpredictable cwd.
    stubPlatform('darwin');
    expect(isAcceptableToolPath('my-project')).toBe(false);
    expect(isAcceptableToolPath('./my-project')).toBe(false);
    expect(isAcceptableToolPath('../sibling-project')).toBe(false);
  });

  it('accepts "~\\..." only on win32', () => {
    stubPlatform('win32');
    expect(isAcceptableToolPath('~\\projects\\client-a')).toBe(true);
    stubPlatform('darwin');
    expect(isAcceptableToolPath('~\\projects\\client-a')).toBe(false);
  });

  it('accepts an already-absolute win32 path', () => {
    stubPlatform('win32');
    expect(isAcceptableToolPath('C:\\Users\\me\\projects\\client-a')).toBe(true);
  });

  it('rejects a relative path on win32 too', () => {
    stubPlatform('win32');
    expect(isAcceptableToolPath('my-project')).toBe(false);
  });
});
