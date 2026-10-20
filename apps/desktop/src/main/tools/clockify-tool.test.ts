import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCKIFY_APP_NAME, ERROR_CODES } from '@workspace-launcher/shared';
import { clockifyTool } from './clockify-tool';
import { getPlatformLauncher } from '../platform';
import { resolveAppLaunchTarget } from './resolve-app-path';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

// Real detection shells out to plutil/scans /Applications — never
// exercised in a unit test, same precedent as every other filesystem/
// subprocess dependency in this suite. Its own logic is covered
// directly by app-detection.test.ts/resolve-app-path.test.ts.
vi.mock('./resolve-app-path', () => ({
  resolveAppLaunchTarget: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const mockedResolveAppLaunchTarget = vi.mocked(resolveAppLaunchTarget);
const launchApp = vi.fn();

beforeEach(() => {
  launchApp.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp,
    openInApp: vi.fn(),
    openUrlInBrowserProfile: vi.fn(),
  });
  mockedResolveAppLaunchTarget.mockReset().mockResolvedValue({
    ok: true,
    target: CLOCKIFY_APP_NAME,
  });
});

describe('clockifyTool', () => {
  it('has type "clockify"', () => {
    expect(clockifyTool.type).toBe('clockify');
  });

  describe('validate', () => {
    it('accepts an empty object', () => {
      expect(clockifyTool.validate({})).toEqual({ valid: true, data: {} });
    });

    it('rejects non-object input', () => {
      expect(clockifyTool.validate('nope').valid).toBe(false);
    });

    it('accepts (ignores) extra unknown fields', () => {
      // No .strict() — same convention as spotify's schema — passes
      // unknown keys through untouched rather than rejecting them.
      expect(clockifyTool.validate({ extra: 'field' })).toEqual({
        valid: true,
        data: {},
      });
    });

    it('accepts and passes through an optional appPath', () => {
      const result = clockifyTool.validate({ appPath: '/Applications/Clockify.app' });
      expect(result).toEqual({
        valid: true,
        data: { appPath: '/Applications/Clockify.app' },
      });
    });
  });

  describe('run', () => {
    it('launches Clockify Desktop via the platform launcher', async () => {
      launchApp.mockResolvedValueOnce({ success: true, message: 'Launched Clockify Desktop.' });

      const result = await clockifyTool.run({}, { workspaceId: 'ws-1' });

      expect(launchApp).toHaveBeenCalledWith('Clockify Desktop');
      expect(result.success).toBe(true);
    });

    it('surfaces a platform-launcher failure as a failed StepResult, not a throw', async () => {
      launchApp.mockResolvedValueOnce({
        success: false,
        message: 'Clockify Desktop not installed',
      });

      const result = await clockifyTool.run({}, { workspaceId: 'ws-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Clockify Desktop not installed');
      expect(result.code).toBe(ERROR_CODES.APP_LAUNCH_FAILED.code);
    });

    it('fails loudly and never launches anything when resolution fails', async () => {
      mockedResolveAppLaunchTarget.mockResolvedValueOnce({
        ok: false,
        message: 'Clockify Desktop not found at /old/path — it may have moved or been uninstalled.',
      });

      const result = await clockifyTool.run({}, { workspaceId: 'ws-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found at /old/path');
      expect(result.message).toContain('Clockify was not opened');
      expect(result.code).toBe(ERROR_CODES.APP_PATH_NOT_FOUND.code);
      expect(launchApp).not.toHaveBeenCalled();
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await clockifyTool.teardown({});
      expect(result.success).toBe(true);
    });
  });

  describe('detail', () => {
    it('always returns the same generic message, regardless of params', () => {
      expect(clockifyTool.detail?.({})).toBe('Opens Clockify.');
      expect(clockifyTool.detail?.({ anything: 'garbage', n: 42 })).toBe('Opens Clockify.');
    });
  });

  describe('expand', () => {
    it('always returns undefined (no expand panel — nothing to show)', () => {
      expect(clockifyTool.expand?.({})).toBeUndefined();
      expect(clockifyTool.expand?.({ anything: 'garbage' })).toBeUndefined();
    });
  });
});
