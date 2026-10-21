// electron-store is pinned to ^8.x in package.json deliberately — see
// step-timing-history.ts's identical doc comment (v9+ is pure ESM,
// incompatible with this main process's CommonJS build output).
import Store from 'electron-store';

/**
 * Per-workspace global-hotkey BASE accelerator (Electron accelerator
 * string, e.g. "CommandOrControl+Alt+1") — see hotkey-service.ts for
 * how this is turned into live OS-level registrations. The Shift
 * variant (fires Switch instead of Restore) is always derived from
 * this string at registration time, never stored separately — see
 * @workspace-launcher/shared's switchAccelerator().
 */
interface WorkspaceHotkeysShape {
  bindings: Record<string, string>;
}

const hotkeysStore = new Store<WorkspaceHotkeysShape>({
  name: 'workspace-hotkeys',
  defaults: { bindings: {} },
});

export function getHotkeyBinding(workspaceId: string): string | undefined {
  return hotkeysStore.get('bindings')[workspaceId];
}

export function getAllHotkeyBindings(): Record<string, string> {
  return hotkeysStore.get('bindings');
}

export function setHotkeyBinding(workspaceId: string, accelerator: string): void {
  const all = hotkeysStore.get('bindings');
  hotkeysStore.set('bindings', { ...all, [workspaceId]: accelerator });
}

export function clearHotkeyBinding(workspaceId: string): void {
  const all = { ...hotkeysStore.get('bindings') };
  delete all[workspaceId];
  hotkeysStore.set('bindings', all);
}
