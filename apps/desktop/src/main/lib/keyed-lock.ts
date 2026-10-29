/**
 * Mutual exclusion per string key, for async work in the (single-
 * threaded) main process: callers holding the same key run one after
 * another, in arrival order; different keys don't wait on each other.
 *
 * Used by per-resource tracking (WCs/WC__window-tracking.md, Stage 2
 * plan section 5) to serialize work per workspace and per resource
 * identity. Not reentrant: code that already holds a key must not ask
 * for it again — it would wait on itself forever.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Runs `fn` while holding every key in `keys`. Keys are taken in
   * sorted order, so two callers asking for overlapping sets can never
   * each hold one key the other needs. Released even when `fn` throws.
   */
  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    try {
      for (const key of ordered) {
        releases.push(await this.acquire(key));
      }
      return await fn();
    } finally {
      releases.reverse().forEach((release) => release());
    }
  }

  /** Whether anyone holds or is waiting for this key — for tests and diagnostics. */
  isLocked(key: string): boolean {
    return this.tails.has(key);
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      // Only the last waiter's tail clears the entry; an earlier
      // holder releasing mustn't erase a later waiter's place in line.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
