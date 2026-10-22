/**
 * A single, process-wide "something is actively running/closing a
 * workspace right now" flag. "Save my current workspace" detection
 * checks this before scanning (workspace-detection.ts) — scanning mid-
 * Restore/Switch/Close would capture a half-transitioned environment
 * (apps still launching, or mid-quit), not a real, stable snapshot.
 *
 * Deliberately NOT the hotkey service's own `inFlight` set
 * (hotkey-service.ts) — that one is per-workspace and only covers
 * hotkey-triggered runs; a renderer-initiated restore/switch/close
 * (clicking the button) never touches it at all. This flag must wrap
 * EVERY real entry point that runs or closes a workspace
 * (ipc/handlers.ts's restoreWorkspace, switchWorkspace,
 * closeWorkspaceStep), regardless of what triggered it.
 *
 * A reference count, not a plain boolean, so two overlapping calls
 * (e.g. a hotkey fires while a button-click restore is still running)
 * can't have whichever one finishes first clear a flag the other still
 * needs.
 */
let busyCount = 0;

export function isOrchestratorBusy(): boolean {
  return busyCount > 0;
}

export async function withOrchestratorBusy<T>(fn: () => Promise<T>): Promise<T> {
  busyCount += 1;
  try {
    return await fn();
  } finally {
    busyCount -= 1;
  }
}
