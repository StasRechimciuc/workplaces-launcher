import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAppIconCacheForTests, fetchAppIcon, getCachedAppIcon } from './app-icon-cache';

beforeEach(() => {
  __resetAppIconCacheForTests();
});

describe('getCachedAppIcon', () => {
  it('returns undefined for a path never fetched', () => {
    expect(getCachedAppIcon('/Applications/Figma.app')).toBeUndefined();
  });
});

describe('fetchAppIcon', () => {
  it('calls the fetcher and caches the result on a cache miss', async () => {
    const fetcher = vi.fn().mockResolvedValue('data:image/png;base64,abc');

    const result = await fetchAppIcon('/Applications/Figma.app', fetcher);

    expect(result).toBe('data:image/png;base64,abc');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCachedAppIcon('/Applications/Figma.app')).toBe('data:image/png;base64,abc');
  });

  it('caches a null result (icon unavailable) too, not just a successful one', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);

    await fetchAppIcon('/Applications/Gone.app', fetcher);

    expect(getCachedAppIcon('/Applications/Gone.app')).toBeNull();
  });

  it('returns the cached value without calling the fetcher again on a cache hit', async () => {
    const fetcher = vi.fn().mockResolvedValue('data:image/png;base64,abc');
    await fetchAppIcon('/Applications/Figma.app', fetcher);

    const result = await fetchAppIcon('/Applications/Figma.app', fetcher);

    expect(result).toBe('data:image/png;base64,abc');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dedupes two concurrent calls for the same path into one fetcher call', async () => {
    let resolveFetch: (value: string | null) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const p1 = fetchAppIcon('/Applications/Figma.app', fetcher);
    const p2 = fetchAppIcon('/Applications/Figma.app', fetcher);
    resolveFetch('data:image/png;base64,abc');

    expect(await p1).toBe('data:image/png;base64,abc');
    expect(await p2).toBe('data:image/png;base64,abc');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fetches independently for two different paths', async () => {
    const fetcher = vi.fn((path: string) => Promise.resolve(`data:${path}`));

    const resultA = await fetchAppIcon('/Applications/A.app', fetcher);
    const resultB = await fetchAppIcon('/Applications/B.app', fetcher);

    expect(resultA).toBe('data:/Applications/A.app');
    expect(resultB).toBe('data:/Applications/B.app');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
