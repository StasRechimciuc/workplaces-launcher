/**
 * In-memory, module-level cache for app icons fetched via
 * window.api.getAppIcon — shared across every ToolBadge instance for
 * the lifetime of the renderer process. Deliberately not persisted to
 * disk or embedded in workspace config: re-deriving an icon is cheap,
 * and persisting it would create a staleness problem (the app's own
 * icon can change after an update) with no invalidation signal to
 * detect that. Kept separate from useAppIcon.ts (the React wrapper) so
 * the cache/dedup behavior itself is testable without a DOM — this
 * codebase's established pattern for a hook's non-trivial logic (see
 * useGlobalShortcuts.ts's matchesCombo).
 */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

/** undefined = not yet fetched; null = fetched, but no icon available. */
export function getCachedAppIcon(path: string): string | null | undefined {
  return cache.get(path);
}

/**
 * Returns the cached result immediately if present, otherwise calls
 * `fetcher` — deduped via `inFlight` so two callers requesting the same
 * path concurrently (e.g. two steps pointing at the same app) only
 * trigger one real IPC round trip.
 */
export function fetchAppIcon(
  path: string,
  fetcher: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const cached = cache.get(path);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const existing = inFlight.get(path);
  if (existing) {
    return existing;
  }

  const promise = fetcher(path).then((result) => {
    cache.set(path, result);
    inFlight.delete(path);
    return result;
  });
  inFlight.set(path, promise);
  return promise;
}

/** Test-only — resets module-level state between cases. */
export function __resetAppIconCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
