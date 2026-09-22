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
        data: { profile: 'Work', urls: [] },
      });
      expect(chromeTool.validate({ profile: 'Work', urls: ['https://example.com'] })).toEqual({
        valid: true,
        data: { profile: 'Work', urls: ['https://example.com'] },
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
      expect(result).toEqual({ valid: true, data: { profile: 'Work', urls: [] } });
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

  describe('detail', () => {
    it('reports a profile-only launch with zero tabs', () => {
      expect(chromeTool.detail?.({ profile: 'Work', urls: [] })).toBe(
        'Opens Chrome (profile: Work).',
      );
    });

    it('pluralizes correctly for one vs multiple tabs', () => {
      expect(chromeTool.detail?.({ profile: 'Work', urls: ['https://a.com'] })).toBe(
        'Opens 1 tab in Chrome (profile: Work).',
      );
      expect(
        chromeTool.detail?.({ profile: 'Work', urls: ['https://a.com', 'https://b.com'] }),
      ).toBe('Opens 2 tabs in Chrome (profile: Work).');
    });

    it('degrades gracefully when profile is missing/invalid raw input', () => {
      // detail() takes RAW params, not validated data — must never
      // throw on a hand-edited/legacy config that fails validate()
      // (profile is schema-required, but that only gates run()/save).
      expect(chromeTool.detail?.({ urls: [] })).toBe('Opens Chrome — no profile configured yet.');
      expect(chromeTool.detail?.({})).toBe('Opens Chrome — no profile configured yet.');
    });
  });

  describe('expand', () => {
    it('returns Profile + Tab rows when profile is present', () => {
      expect(chromeTool.expand?.({ profile: 'Work', urls: ['https://a.com'] })).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
        { i: 'check', label: 'Tab', mono: 'https://a.com' },
      ]);
    });

    it('returns just the Profile row when there are no urls', () => {
      expect(chromeTool.expand?.({ profile: 'Work', urls: [] })).toEqual([
        { i: 'globe', label: 'Profile', mono: 'Work' },
      ]);
    });

    it('returns undefined when profile is missing/invalid raw input', () => {
      expect(chromeTool.expand?.({ urls: [] })).toBeUndefined();
      expect(chromeTool.expand?.({})).toBeUndefined();
    });
  });
});
