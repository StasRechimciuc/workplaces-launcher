import { describe, expect, it } from 'vitest';
import { KeyedLock } from './keyed-lock';

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('KeyedLock', () => {
  it('runs holders of the same key one at a time, in arrival order', async () => {
    const lock = new KeyedLock();
    const events: string[] = [];
    const job = (name: string) =>
      lock.withLocks(['a'], async () => {
        events.push(`${name} start`);
        await tick();
        events.push(`${name} end`);
      });
    await Promise.all([job('1'), job('2'), job('3')]);
    expect(events).toEqual(['1 start', '1 end', '2 start', '2 end', '3 start', '3 end']);
  });

  it('lets different keys run at the same time', async () => {
    const lock = new KeyedLock();
    let concurrent = 0;
    let maxConcurrent = 0;
    const job = (key: string) =>
      lock.withLocks([key], async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await tick();
        concurrent--;
      });
    await Promise.all([job('a'), job('b')]);
    expect(maxConcurrent).toBe(2);
  });

  it('takes overlapping key sets in a fixed order, so crossed requests never deadlock', async () => {
    const lock = new KeyedLock();
    const done: string[] = [];
    await Promise.all([
      lock.withLocks(['a', 'b'], async () => {
        await tick();
        done.push('ab');
      }),
      lock.withLocks(['b', 'a'], async () => {
        await tick();
        done.push('ba');
      }),
    ]);
    expect(done).toEqual(['ab', 'ba']);
  });

  it('releases on throw and clears keys nobody is waiting for', async () => {
    const lock = new KeyedLock();
    await expect(
      lock.withLocks(['a'], async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(lock.isLocked('a')).toBe(false);
    await expect(lock.withLocks(['a'], async () => 'ok')).resolves.toBe('ok');
  });

  it('keeps a later waiter in line when an earlier holder releases', async () => {
    const lock = new KeyedLock();
    const events: string[] = [];
    const first = lock.withLocks(['a'], async () => {
      await tick();
      events.push('first');
    });
    const second = lock.withLocks(['a'], async () => {
      events.push('second');
    });
    await first;
    expect(lock.isLocked('a')).toBe(true);
    await second;
    expect(events).toEqual(['first', 'second']);
    expect(lock.isLocked('a')).toBe(false);
  });
});
