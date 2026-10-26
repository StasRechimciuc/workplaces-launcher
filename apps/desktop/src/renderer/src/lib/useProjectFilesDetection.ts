import { useCallback, useRef, useState } from 'react';
import type { ProjectFilesDetection } from '@workspace-launcher/shared';
import { useIsMounted } from './useIsMounted';
import { DetectionDeduper } from './detection-deduper';

export interface ProjectFilesDetectionState {
  status: 'idle' | 'detecting' | 'done' | 'error';
  result?: ProjectFilesDetection;
  message?: string;
}

export interface ProjectFilesDetectionHandle {
  state: ProjectFilesDetectionState;
  /** No-op while already 'detecting' or 'done' for this exact directory. */
  detect: () => void;
}

export interface ProjectFilesDetections {
  /** A bound view of the shared cache for one directory string. Keyed
   * by directory, not by row key — two Docker steps pointing at the
   * same folder share one scan, never a second redundant filesystem
   * check. */
  forDirectory: (directory: string) => ProjectFilesDetectionHandle;
  /** Clears every cached/in-flight detection — wired into
   * WorkspaceFormModal's resetForm and its edit-mode reseed effect,
   * same precedent as useAppPathDetections' own reset. */
  reset: () => void;
}

const IDLE: ProjectFilesDetectionState = { status: 'idle' };

/**
 * Owns the lifted Docker-directory compose/Tiltfile detection cache for
 * the lifetime of one WorkspaceFormModal mount — same shape and same
 * reason as useAppPathDetections.ts (keyed by directory string instead
 * of tool type): a row's fields block fully unmounts on collapse
 * (WorkspaceFormModal's `hasFields && isOpen` gate), so state owned
 * locally by docker-fields.tsx itself would re-scan on every re-expand.
 */
export function useProjectFilesDetection(): ProjectFilesDetections {
  const [statesByDir, setStatesByDir] = useState<Record<string, ProjectFilesDetectionState>>({});
  const isMountedRef = useIsMounted();
  // Same race guard as useAppPathDetections' own deduperRef — a rapid
  // double-call (e.g. the debounced directory-change effect firing
  // twice before the first setState commits) can't start two scans for
  // the same directory.
  const deduperRef = useRef(new DetectionDeduper<string>());

  const detect = useCallback(
    (directory: string) => {
      const current = statesByDir[directory];
      if (!deduperRef.current.shouldStart(directory, current?.status === 'done')) {
        return;
      }
      setStatesByDir((prev) => ({ ...prev, [directory]: { status: 'detecting' } }));

      window.api
        .detectProjectFiles(directory)
        .then((result) => {
          deduperRef.current.finish(directory);
          if (!isMountedRef.current) return;
          setStatesByDir((prev) => ({
            ...prev,
            [directory]: result.success
              ? {
                  status: 'done',
                  result: {
                    ...(result.composeFile ? { composeFile: result.composeFile } : {}),
                    hasTiltfile: result.hasTiltfile,
                  },
                }
              : { status: 'error', message: result.error },
          }));
        })
        .catch((err: unknown) => {
          deduperRef.current.finish(directory);
          if (!isMountedRef.current) return;
          setStatesByDir((prev) => ({
            ...prev,
            [directory]: {
              status: 'error',
              message: err instanceof Error ? err.message : String(err),
            },
          }));
        });
    },
    [statesByDir, isMountedRef],
  );

  const forDirectory = useCallback(
    (directory: string): ProjectFilesDetectionHandle => ({
      state: statesByDir[directory] ?? IDLE,
      detect: () => {
        detect(directory);
      },
    }),
    [statesByDir, detect],
  );

  const reset = useCallback(() => {
    deduperRef.current.reset();
    setStatesByDir({});
  }, []);

  // Deliberately not memoized together — same reasoning as
  // useAppPathDetections' own identical final comment: `forDirectory`
  // must be unstable (fresh state per change), `reset` must stay
  // referentially stable for callers that depend on it directly.
  return { forDirectory, reset };
}
