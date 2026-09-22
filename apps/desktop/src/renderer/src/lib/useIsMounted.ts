import { useEffect, useRef } from 'react';

/**
 * Returns a ref whose `.current` is true while the calling component is
 * mounted, false after it unmounts. For guarding a `setState` call
 * after an in-flight async operation (an IPC round trip) resolves once
 * the component that started it is already gone — calling `setState`
 * at that point wouldn't crash React, but it's a no-op at best and a
 * sign of a leak at worst, so callers check `.current` before setting
 * state in an async continuation.
 *
 * Previously hand-rolled identically in Detail.tsx, WorkspaceFormModal.tsx,
 * and DeleteWorkspaceConfirm.tsx — one shared implementation here so a
 * future fix (e.g. migrating to AbortController-based cancellation)
 * only has to happen once.
 */
export function useIsMounted(): React.RefObject<boolean> {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return isMountedRef;
}
