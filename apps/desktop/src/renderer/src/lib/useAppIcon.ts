import { useEffect, useState } from 'react';
import { useIsMounted } from './useIsMounted';
import { fetchAppIcon, getCachedAppIcon } from './app-icon-cache';

/**
 * Resolves the given app's own real icon (ToolBadge.tsx's 'app' type
 * case) via the shared module-level cache in app-icon-cache.ts — a
 * cache hit resolves synchronously inside the effect (no flash on a
 * second ToolBadge instance for the same path); a miss shows null
 * (ToolBadge falls back to the generic tinted badge) until the fetch
 * resolves. `path` undefined (not the 'app' type, or no app chosen
 * yet) always returns null without ever calling the IPC bridge.
 */
export function useAppIcon(path: string | undefined): string | null {
  const [icon, setIcon] = useState<string | null>(null);
  const isMountedRef = useIsMounted();

  useEffect(() => {
    if (!path) {
      setIcon(null);
      return;
    }

    const cached = getCachedAppIcon(path);
    if (cached !== undefined) {
      setIcon(cached);
      return;
    }

    setIcon(null);
    fetchAppIcon(path, window.api.getAppIcon).then((result) => {
      if (isMountedRef.current) {
        setIcon(result);
      }
    });
  }, [path, isMountedRef]);

  return icon;
}
