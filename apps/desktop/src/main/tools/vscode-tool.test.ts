import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vscodeTool } from './vscode-tool';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);

const openInApp = vi.fn();

beforeEach(() => {
  openInApp.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp: vi.fn(),
    openInApp,
    openUrlInBrowserProfile: vi.fn(),
  });
});

describe('vscodeTool', () => {
  it('has type "vscode"', () => {
    expect(vscodeTool.type).toBe('vscode');
  });

  describe('validate', () => {
    it('accepts a params object with a non-empty path', () => {
      const result = vscodeTool.validate({ path: '/Users/me/projects/client-a' });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('rejects params missing path', () => {
      const result = vscodeTool.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects an empty-string path', () => {
      const result = vscodeTool.validate({ path: '' });
      expect(result.valid).toBe(false);
    });

    it('rejects non-object input', () => {
      const result = vscodeTool.validate('/Users/me/projects/client-a');
      expect(result.valid).toBe(false);
    });
  });

  describe('run', () => {
    it('opens the given path in Visual Studio Code via the platform launcher', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a' },
        { workspaceId: 'ws-1' },
      );

      expect(openInApp).toHaveBeenCalledWith('Visual Studio Code', '/Users/me/projects/client-a');
      expect(result.success).toBe(true);
      expect(typeof result.durationMs).toBe('number');
    });

    it('expands a leading ~ before calling the platform launcher', async () => {
      openInApp.mockResolvedValueOnce({ success: true, message: 'Opened.' });

      await vscodeTool.run({ path: '~/projects/client-a' }, { workspaceId: 'ws-1' });

      const [, calledPath] = openInApp.mock.calls[0]!;
      expect(calledPath).not.toContain('~');
      expect(calledPath.endsWith('/projects/client-a')).toBe(true);
    });

    it('surfaces a platform-launcher failure as a failed StepResult, not a throw', async () => {
      openInApp.mockResolvedValueOnce({ success: false, message: 'app not found' });

      const result = await vscodeTool.run(
        { path: '/Users/me/projects/client-a' },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('app not found');
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await vscodeTool.teardown({ path: '/Users/me/projects/client-a' });
      expect(result.success).toBe(true);
    });
  });
});
