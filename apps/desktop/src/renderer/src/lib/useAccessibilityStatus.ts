import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessibilityStatus } from '@workspace-launcher/shared';

/**
 * The app-wide Accessibility status (see AccessibilityStatus in
 * @workspace-launcher/shared) — drives the first-launch onboarding
 * modal, the reduced-mode banner and the Settings row, all owned by
 * App.tsx. `null` until the first read resolves, so nothing flashes
 * "off" before the real answer is in.
 *
 * Re-read on window focus, same reasoning as App.tsx's own
 * workspace-list refresh: the user grants or revokes the permission in
 * System Settings, entirely outside this app, and coming back to this
 * window is the moment that change matters. Stops listening entirely
 * once the status is 'unsupported' (not macOS) — it can never change.
 * The onboarding modal polls on its own while open; this hook is only
 * the background read.
 */
export function useAccessibilityStatus(): {
  status: AccessibilityStatus | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<AccessibilityStatus | null>(null);
  // Each spawn of `wl-helper trust` is cheap, but a burst of focus
  // events must not stack several of them — one read at a time.
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setStatus(await window.api.getAccessibilityStatus());
    } catch (err) {
      // An IPC failure isn't a permission answer — keep whatever was
      // last known rather than guessing, but never swallow it silently.
      console.error(
        `Failed to read Accessibility status: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isUnsupported = status?.state === 'unsupported';
  useEffect(() => {
    if (isUnsupported) return;
    const handleFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isUnsupported, refresh]);

  return { status, refresh };
}
