// electron-store is pinned to ^8.x in package.json deliberately — see
// step-timing-history.ts's identical doc comment (v9+ is pure ESM,
// incompatible with this main process's CommonJS build output).
import Store from 'electron-store';

/**
 * Per-workspace INTENT only — set by Restore/Switch-to, cleared by
 * Close (see WCs/WC__workspace-activity.md). This is deliberately
 * the only thing persisted for workspace activity tracking: liveness
 * (is an app actually still running) is always checked fresh via
 * process-control.ts, never stored, so it can't go stale. Intent alone
 * can only make "Active" show true when backed by real liveness —
 * callers always AND this with a liveness check, never trust it alone.
 */
interface WorkspaceActivityShape {
  intentActive: Record<string, boolean>;
}

const activityStore = new Store<WorkspaceActivityShape>({
  name: 'workspace-activity',
  defaults: { intentActive: {} },
});

export function isIntentActive(workspaceId: string): boolean {
  return !!activityStore.get('intentActive')[workspaceId];
}

export function setIntentActive(workspaceId: string, active: boolean): void {
  const all = activityStore.get('intentActive');
  activityStore.set('intentActive', { ...all, [workspaceId]: active });
}
