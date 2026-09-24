import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clockifyTool } from './clockify-tool';
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
      // z.object({}) with no .strict() — same convention as spotify's
      // schema — passes unknown keys through untouched rather than
      // rejecting them.
      expect(clockifyTool.validate({ extra: 'field' })).toEqual({
        valid: true,
        data: {},
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
