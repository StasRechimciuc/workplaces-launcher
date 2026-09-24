/**
 * Live per-step signal emitted while a workspace restore is running —
 * a minimal addition on top of the batched final StepResult[] (see
 * orchestrator.ts), not a replacement for it. Scoped deliberately small
 * (build-shell.md's "Config UX"/Tier 2 "Real per-step state" items stay
 * separate, bigger work): just enough for the renderer to show "Step X
 * of N" and for the main process to know when to re-assert window
 * focus, nothing richer (no per-step running/stopped/needs-attention
 * state machine).
 */
export interface RestoreProgressEvent {
  /** Which workspace this event belongs to — lets a listener ignore
   * events from a stale/overlapping restore of a different workspace. */
  workspaceId: string;
  stepIndex: number;
  total: number;
  status: 'running' | 'success' | 'failure';
  message?: string;
}

/** IPC channel name shared between the main process and preload — a
 * single source so the two never drift into mismatched literals. */
export const RESTORE_PROGRESS_CHANNEL = 'workspaces:restore-progress';
