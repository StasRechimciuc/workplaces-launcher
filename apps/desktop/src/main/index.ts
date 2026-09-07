import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { registerIpcHandlers } from './ipc/handlers';
import { buildAppMenu } from './menu';
import { registerBuiltInTools } from './tools';

app.setName('Workspace Launcher');

// Single-instance lock: without this, launching the app a second time
// (e.g. double-clicking the dock icon while it's already running)
// starts a second process that reads/writes the same on-disk workspace
// configs and settings as the first — a real data-race risk, not just
// a cosmetic "two windows" annoyance. The second launch instead just
// focuses the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    // The renderer (adapted from mockup_design/index.html) draws its own
    // title bar and traffic lights — it was designed as a "floating
    // window mockup" card, not edge-to-edge OS content. Frameless here
    // so macOS doesn't also draw a second, real title bar around it.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
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

  const rendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined;
  const loadPromise = rendererUrl
    ? mainWindow.loadURL(rendererUrl)
    : mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  // Never let a failed load pass silently — with no renderer, this app
  // is just a blank window with no way for the user to know why. This
  // is main-process-only failure (the renderer itself couldn't load),
  // so it can't be shown in the UI — a native dialog is the only way to
  // actually surface it.
  loadPromise.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load the renderer: ${message}`);
    dialog.showErrorBox(
      'Workspace Launcher failed to start',
      `The app window could not load its interface:\n\n${message}`,
    );
  });

  return mainWindow;
}

if (gotSingleInstanceLock) {
  // Someone tried to launch a second instance — focus the existing
  // window instead of letting a second process start.
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.workspacelauncher.app');
    Menu.setApplicationMenu(buildAppMenu());

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    registerBuiltInTools();
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
}
