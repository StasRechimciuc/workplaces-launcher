import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeTool } from './chrome-tool';
import { getPlatformLauncher } from '../platform';

vi.mock('../platform', () => ({
  getPlatformLauncher: vi.fn(),
}));

const mockedGetPlatformLauncher = vi.mocked(getPlatformLauncher);
const openUrlInBrowserProfile = vi.fn();

beforeEach(() => {
  openUrlInBrowserProfile.mockReset();
  mockedGetPlatformLauncher.mockReset();
  mockedGetPlatformLauncher.mockReturnValue({
    launchApp: vi.fn(),
    openInApp: vi.fn(),
    openUrlInBrowserProfile,
  });
});

describe('chromeTool', () => {
  it('has type "chrome"', () => {
    expect(chromeTool.type).toBe('chrome');
  });

  describe('validate', () => {
    it('accepts a params object with a profile and zero or more urls', () => {
      expect(chromeTool.validate({ profile: 'Work', urls: [] })).toEqual({
        valid: true,
        errors: [],
      });
      expect(chromeTool.validate({ profile: 'Work', urls: ['https://example.com'] })).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('rejects params missing profile', () => {
      expect(chromeTool.validate({ urls: [] }).valid).toBe(false);
    });

    it('rejects an empty-string profile', () => {
      expect(chromeTool.validate({ profile: '', urls: [] }).valid).toBe(false);
    });

    it('accepts params missing urls, defaulting to an empty array (profile-only launch)', () => {
      const result = chromeTool.validate({ profile: 'Work' });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('rejects a urls array containing an empty string', () => {
      expect(chromeTool.validate({ profile: 'Work', urls: [''] }).valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(chromeTool.validate('Work').valid).toBe(false);
    });
  });

  describe('run', () => {
    it('launches the profile with no url argument when urls is empty', async () => {
      openUrlInBrowserProfile.mockResolvedValueOnce({
        success: true,
        message: 'Opened Google Chrome (profile: Work).',
      });

      const result = await chromeTool.run({ profile: 'Work', urls: [] }, { workspaceId: 'ws-1' });

      expect(openUrlInBrowserProfile).toHaveBeenCalledTimes(1);
      expect(openUrlInBrowserProfile).toHaveBeenCalledWith('Google Chrome', 'Work');
      expect(result.success).toBe(true);
    });

    it('does not crash when urls is entirely absent from params (not just empty)', async () => {
      // Regression test: a step saved before the urls textarea was ever
      // touched is persisted as {profile: '...'} with no urls key at
      // all — validate()'s zod default([]) only affects pass/fail, it
      // never writes the defaulted value back into what run() receives.
      openUrlInBrowserProfile.mockResolvedValueOnce({
        success: true,
        message: 'Opened Google Chrome (profile: Work).',
      });

      const result = await chromeTool.run(
        { profile: 'Work' } as unknown as Parameters<typeof chromeTool.run>[0],
        { workspaceId: 'ws-1' },
      );

      expect(openUrlInBrowserProfile).toHaveBeenCalledWith('Google Chrome', 'Work');
      expect(result.success).toBe(true);
    });

    it('opens each url sequentially, in order, against the same profile', async () => {
      const order: string[] = [];
      openUrlInBrowserProfile.mockImplementation(
        async (_browser: string, _profile: string, url?: string) => {
          order.push(url ?? '(none)');
          return { success: true, message: `Opened ${url}.` };
        },
      );

      const result = await chromeTool.run(
        { profile: 'Work', urls: ['https://a.com', 'https://b.com', 'https://c.com'] },
        { workspaceId: 'ws-1' },
      );

      expect(openUrlInBrowserProfile).toHaveBeenCalledTimes(3);
      expect(order).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
      expect(openUrlInBrowserProfile).toHaveBeenNthCalledWith(
        1,
        'Google Chrome',
        'Work',
        'https://a.com',
      );
      expect(openUrlInBrowserProfile).toHaveBeenNthCalledWith(
        2,
        'Google Chrome',
        'Work',
        'https://b.com',
      );
      expect(openUrlInBrowserProfile).toHaveBeenNthCalledWith(
        3,
        'Google Chrome',
        'Work',
        'https://c.com',
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('3 tabs');
    });

    it('reports a partial failure, naming which url(s) failed and why, without throwing', async () => {
      openUrlInBrowserProfile
        .mockResolvedValueOnce({ success: true, message: 'Opened https://a.com.' })
        .mockResolvedValueOnce({ success: false, message: 'Chrome not found.' })
        .mockResolvedValueOnce({ success: true, message: 'Opened https://c.com.' });

      const result = await chromeTool.run(
        { profile: 'Work', urls: ['https://a.com', 'https://b.com', 'https://c.com'] },
        { workspaceId: 'ws-1' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('https://b.com');
      expect(result.message).toContain('Chrome not found.');
      expect(result.message).toContain('2 of 3');
    });

    it('surfaces a platform-launcher failure as a failed StepResult for the zero-urls case', async () => {
      openUrlInBrowserProfile.mockResolvedValueOnce({
        success: false,
        message: 'profile not found',
      });

      const result = await chromeTool.run({ profile: 'Ghost', urls: [] }, { workspaceId: 'ws-1' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('profile not found');
    });
  });

  describe('teardown', () => {
    it('is a successful no-op (Tier 2 not built yet)', async () => {
      const result = await chromeTool.teardown({ profile: 'Work', urls: [] });
      expect(result.success).toBe(true);
    });
  });
});
