import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = 1_700_000_000_000;

describe('formatRelativeTime', () => {
  it('returns "just now" for under a minute', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 45_000, NOW)).toBe('just now');
  });

  it('formats whole minutes under an hour', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2 min ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
  });

  it('formats whole hours under a day', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });

  it('formats whole days beyond that', () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
  });

  it('treats a future timestamp as "just now" rather than a negative duration', () => {
    expect(formatRelativeTime(NOW + 10_000, NOW)).toBe('just now');
  });
});
