import { useCallback, useRef, useState } from 'react';
import type { AppCandidate, ToolAppKey } from '@workspace-launcher/shared';
import { useIsMounted } from './useIsMounted';
import { DetectionDeduper } from './detection-deduper';

export interface AppPathDetectionState {
  status: 'idle' | 'detecting' | 'done' | 'error';
  candidates?: AppCandidate[];
  message?: string;
}

export interface AppPathDetection {
  state: AppPathDetectionState;
  /** No-op while already 'detecting' or 'done' for this tool type. */
  detect: () => void;
}

export interface AppPathDetections {
  /** A bound view of the shared cache for one tool type. Deliberately
   * keyed by TOOL TYPE, not by row key — the real-install scan result
   * is identical for every row of the same type in one modal session,
   * so two VS Code steps in the same workspace share one detection,
   * never triggering a second redundant filesystem scan. */
  forTool: (toolType: ToolAppKey) => AppPathDetection;
  /** Clears every cached/in-flight detection — wired into
   * WorkspaceFormModal's resetForm and its edit-mode reseed effect, so
   * a detection from a previous editing session is never carried
   * across into a new one without a fresh check. */
  reset: () => void;
}

const IDLE: AppPathDetectionState = { status: 'idle' };

/**
 * Owns the lifted app-location-detection cache for the lifetime of one
 * WorkspaceFormModal mount — same altitude/instantiation pattern as
 * useSpotifyConnection. Lifted here specifically because a row's
 * fields block fully unmounts on collapse (WorkspaceFormModal's
 * `hasFields && isOpen` gate); local state inside the fields component
 * itself would re-fetch every single time a row is re-expanded.
 */
export function useAppPathDetections(): AppPathDetections {
  const [statesByTool, setStatesByTool] = useState<Partial<Record<ToolAppKey, AppPathDetectionState>>>(
    {},
  );
  const isMountedRef = useIsMounted();
  // Tracks which tool types already have a detect() in flight, via the
  // pure DetectionDeduper (see detection-deduper.ts) — separate from
  // React state so a rapid double-mount (e.g. two rows of the same
  // type mounting in the same tick) can't race past the 'detecting'
  // status check before the first setState commits.
  const deduperRef = useRef(new DetectionDeduper<ToolAppKey>());

  const detect = useCallback(
    (toolType: ToolAppKey) => {
      const current = statesByTool[toolType];
      if (!deduperRef.current.shouldStart(toolType, current?.status === 'done')) {
        return;
      }
      setStatesByTool((prev) => ({ ...prev, [toolType]: { status: 'detecting' } }));

      window.api
        .detectInstalledApp(toolType)
        .then((result) => {
          deduperRef.current.finish(toolType);
          if (!isMountedRef.current) return;
          setStatesByTool((prev) => ({
            ...prev,
            [toolType]: result.success
              ? { status: 'done', candidates: result.candidates }
              : { status: 'error', message: result.error },
          }));
        })
        .catch((err: unknown) => {
          deduperRef.current.finish(toolType);
          if (!isMountedRef.current) return;
          setStatesByTool((prev) => ({
            ...prev,
            [toolType]: {
              status: 'error',
              message: err instanceof Error ? err.message : String(err),
            },
          }));
        });
    },
    [statesByTool, isMountedRef],
  );

  const forTool = useCallback(
    (toolType: ToolAppKey): AppPathDetection => ({
      state: statesByTool[toolType] ?? IDLE,
      detect: () => {
        detect(toolType);
      },
    }),
    [statesByTool, detect],
  );

  const reset = useCallback(() => {
    deduperRef.current.reset();
    setStatesByTool({});
  }, []);

  // Deliberately NOT memoized as one object: `forTool` is intentionally
  // unstable (it must return fresh state as statesByTool changes), but
  // `reset` itself is permanently stable (empty deps). Callers that
  // need a stable dependency (WorkspaceFormModal's resetForm) must
  // depend on `.reset` directly, never on this whole returned object —
  // wrapping both in one memoized object keyed on [forTool, reset]
  // would make the object's identity change every time `forTool` does,
  // i.e. every time ANY detection's state changes, which would recreate
  // anything depending on the object itself.
  return { forTool, reset };
}
