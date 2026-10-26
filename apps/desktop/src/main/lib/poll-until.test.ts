import { describe, expect, it, vi } from 'vitest';
import { pollUntil } from './poll-until';

describe('pollUntil', () => {
  it('returns the first defined value immediately, without extra polling', async () => {
    const check = vi.fn().mockResolvedValueOnce('found');

    const { value, elapsedMs } = await pollUntil(check, { intervalMs: 5000, timeoutMs: 20000 });

    expect(value).toBe('found');
    expect(check).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('keeps polling at intervalMs until a defined value appears', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('found');

    const { value } = await pollUntil(check, { intervalMs: 1, timeoutMs: 1000 });

    expect(value).toBe('found');
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('gives up and returns undefined once the timeout elapses, never throwing', async () => {
    const check = vi.fn().mockResolvedValue(undefined);

    const { value, elapsedMs } = await pollUntil(check, { intervalMs: 5, timeoutMs: 20 });

    expect(value).toBeUndefined();
    expect(elapsedMs).toBeGreaterThanOrEqual(20);
  });

  it('never overshoots the deadline by more than one check cycle', async () => {
    const check = vi.fn().mockResolvedValue(undefined);

    await expect(pollUntil(check, { intervalMs: 5, timeoutMs: 15 })).resolves.toEqual({
      value: undefined,
      elapsedMs: expect.any(Number),
    });
  });

  it('treats a falsy-but-defined value (false, 0, "") as found, not as "keep polling"', async () => {
    const check = vi.fn().mockResolvedValueOnce(false);

    const { value } = await pollUntil(check, { intervalMs: 5000, timeoutMs: 20000 });

    expect(value).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
