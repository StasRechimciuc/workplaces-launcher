import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { appTool } from './app-tool';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const launchApp = vi.fn();

beforeEach(() => {
  launchApp.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp,
    openInApp: vi.fn(),
    openUrlInBrowserProfile: vi.fn(),
  });
});

describe('appTool', () => {
  it('has type "app"', () => {
    expect(appTool.type).toBe('app');
  });

  describe('validate', () => {
    it('accepts a non-empty path', () => {
      expect(appTool.validate({ path: '/Applications/Figma.app' })).toEqual({
        valid: true,
        data: { path: '/Applications/Figma.app' },
      });
    });

    it('rejects a missing path', () => {
      expect(appTool.validate({}).valid).toBe(false);
    });

    it('rejects an empty string path', () => {
      expect(appTool.validate({ path: '' }).valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(appTool.validate('nope').valid).toBe(false);
    });
  });

  describe('run', () => {
    it("launches the step's exact configured path via the platform launcher", async () => {
      launchApp.mockResolvedValueOnce({ success: true, message: 'Launched Figma.' });

      const result = await appTool.run({ path: '/Applications/Figma.app' }, { workspaceId: 'ws-1' });

      expect(launchApp).toHaveBeenCalledWith('/Applications/Figma.app');
      expect(result.success).toBe(true);
    });

    it('surfaces a platform-launcher failure as a failed StepResult, not a throw', async () => {
      launchApp.mockResolvedValueOnce({ success: false, message: 'App not found' });

      const result = await appTool.run({ path: '/Applications/Gone.app' }, { workspaceId: 'ws-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('App not found');
      expect(result.code).toBe(ERROR_CODES.APP_LAUNCH_FAILED.code);
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await appTool.teardown({ path: '/Applications/Figma.app' });
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('derives a display name from the bundle path', () => {
      expect(appTool.detail?.({ path: '/Applications/Figma.app' })).toBe('Opens Figma.');
    });

    it('strips only a trailing .app suffix, not an app name that happens to contain "app"', () => {
      expect(appTool.detail?.({ path: '/Applications/Keynote App.app' })).toBe('Opens Keynote App.');
    });

    it('falls back to a generic message when path is missing or not a string', () => {
      expect(appTool.detail?.({})).toBe('Opens an app.');
      expect(appTool.detail?.({ path: 42 })).toBe('Opens an app.');
    });
  });

  describe('expand', () => {
    it('returns one row with the derived app name', () => {
      expect(appTool.expand?.({ path: '/Applications/Figma.app' })).toEqual([
        { i: 'appWindow', label: 'App', mono: 'Figma' },
      ]);
    });

    it('returns undefined when path is missing or not a string', () => {
      expect(appTool.expand?.({})).toBeUndefined();
      expect(appTool.expand?.({ path: 42 })).toBeUndefined();
    });
  });
});
