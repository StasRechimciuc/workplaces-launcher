import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { registerIpcHandlers } from './ipc/handlers';

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security baseline (claude.md Code Quality Standard: least
      // privilege by default). The renderer gets zero direct Node/
      // Electron access — everything it can do goes through the
      // explicit, narrow bridge in src/preload/index.ts.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Never let the renderer navigate the app window to, or open, an
  // arbitrary external URL in-place — hand it to the user's real
  // browser instead.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.workspacelauncher.app');

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
