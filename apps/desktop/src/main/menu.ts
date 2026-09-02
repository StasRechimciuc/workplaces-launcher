import { app, Menu, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

/**
 * A minimal native application menu. main/index.ts sets
 * autoHideMenuBar on the BrowserWindow, but that only hides the menu
 * *bar* on Windows/Linux — macOS always shows the global menu bar
 * regardless, and on every platform, Electron only wires up standard
 * shortcuts (Cmd/Ctrl+C, +V, +Z, +Q, ...) when an application menu
 * with the matching roles exists. Without this, text inputs in the
 * renderer (e.g. the "new workspace" name field) can't be copied into
 * or out of via keyboard shortcut.
 */
export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Workspace Launcher on GitHub',
        click: () => {
          void shell.openExternal('https://github.com/StasRechimciuc/workplaces-launcher');
        },
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [macAppMenu, editMenu, windowMenu, helpMenu]
    : [editMenu, windowMenu, helpMenu];

  return Menu.buildFromTemplate(template);
}
