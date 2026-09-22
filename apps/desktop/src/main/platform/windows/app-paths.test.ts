import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

const existsSync = vi.mocked(fs.existsSync);

beforeEach(() => {
  existsSync.mockReset();
  vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\dev\\AppData\\Local');
  vi.stubEnv('APPDATA', 'C:\\Users\\dev\\AppData\\Roaming');
  vi.stubEnv('ProgramFiles', 'C:\\Program Files');
  vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)');
  // app-paths.ts reads process.env once at module load to build its
  // candidate table — reset the module registry so each test's env
  // stubs (set above, or overridden below) actually take effect,
  // rather than reusing the first test's cached candidate paths.
  vi.resetModules();
});

describe('resolveAppPath', () => {
  it('returns the first candidate that exists', async () => {
    existsSync.mockImplementation(
      (path) => path === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    );

    const { resolveAppPath } = await import('./app-paths');
    const result = resolveAppPath('Google Chrome');

    expect(result).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('falls back to a later candidate when an earlier one is missing', async () => {
    existsSync.mockImplementation(
      (path) => path === 'C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    );

    const { resolveAppPath } = await import('./app-paths');
    const result = resolveAppPath('Google Chrome');

    expect(result).toBe('C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('throws with a message naming the app when no candidate exists', async () => {
    existsSync.mockReturnValue(false);

    const { resolveAppPath } = await import('./app-paths');

    expect(() => resolveAppPath('Slack')).toThrow(/Could not find Slack installed/);
  });

  it('throws with a message listing known apps for an unrecognized app name', async () => {
    existsSync.mockReturnValue(false);

    const { resolveAppPath } = await import('./app-paths');

    expect(() => resolveAppPath('NotARealApp')).toThrow(/is not a known Windows app/);
  });

  it('does not throw when an expected env var (e.g. ProgramFiles(x86) on ARM64) is unset', async () => {
    vi.stubEnv('ProgramFiles(x86)', undefined);
    existsSync.mockImplementation(
      (path) => path === 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    );

    const { resolveAppPath } = await import('./app-paths');
    const result = resolveAppPath('Visual Studio Code');

    expect(result).toBe('C:\\Program Files\\Microsoft VS Code\\Code.exe');
  });
});
