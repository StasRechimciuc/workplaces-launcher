// electron-store is pinned to ^8.x in package.json deliberately — see
// step-timing-history.ts's identical doc comment (v9+ is pure ESM,
// incompatible with this main process's CommonJS build output).
import Store from 'electron-store';

/**
 * The single, app-wide "Save my current workspace" global-hotkey
 * accelerator — a parallel, NOT a sibling, to workspace-hotkeys-store.ts's
 * per-workspace map: this action has no workspace id to key by, and no
 * Shift-derived variant (there's no Restore/Switch duality for "save
 * current state" — see WCs/WC__save-current-workspace.md).
 */
interface AppHotkeysShape {
  saveCurrentWorkspace: string | undefined;
}

const appHotkeysStore = new Store<AppHotkeysShape>({
  name: 'app-hotkeys',
  defaults: { saveCurrentWorkspace: undefined },
});

export function getSaveCurrentWorkspaceHotkey(): string | undefined {
  return appHotkeysStore.get('saveCurrentWorkspace');
}

export function setSaveCurrentWorkspaceHotkey(accelerator: string): void {
  appHotkeysStore.set('saveCurrentWorkspace', accelerator);
}

export function clearSaveCurrentWorkspaceHotkey(): void {
  appHotkeysStore.set('saveCurrentWorkspace', undefined);
}
