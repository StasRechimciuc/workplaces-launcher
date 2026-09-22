import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { PRODUCT_NAME } from '@workspace-launcher/shared/vscode-restore';
import { registerIpcHandlers } from './ipc/handlers';
import { buildAppMenu } from './menu';
import { registerBuiltInTools } from './tools';

// Must stay in sync with electron-builder.yml's productName — see
// vscode-restore.ts's own doc comment on PRODUCT_NAME for why this
// specific constant (not a fresh literal) is imported here: the
// desktop app and the VS Code extension both derive their restore-
// handoff data directory from it, and a drift between the two would
// make that handoff silently stop working.
app.setName(PRODUCT_NAME);

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

// The renderer (adapted from mockup_design/index.html) draws its own
// title bar — it was designed as a "floating window mockup" card, not
// edge-to-edge OS content — so the real OS chrome must be fully
// suppressed everywhere, or the OS draws a second, real title bar
// around it (a real, shipped bug for one review round: `titleBarStyle`/
// `trafficLightPosition` are macOS-only options that Electron silently
// *ignores* on Windows/Linux rather than erroring, so this window fell
// back to a normal native-framed window there — on Windows specifically,
// the v1 target platform, not a corner case). `frame: false` is the
// actual cross-platform primitive; `titleBarStyle: 'hiddenInset'` +
// `trafficLightPosition` are a macOS-only refinement on top of it (they
// keep the real traffic-light buttons visible and inset into the custom
// bar, which `frame: false` alone would remove entirely — the two must
// not both be set on darwin, `frame: false` there would just hide the
// traffic lights the design relies on).
const windowFrameOptions =
  process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
    : // `frame: false` alone (no replacement controls anywhere in the
      // renderer) would leave Windows/Linux users with no way to
      // close/minimize the window at all. `titleBarStyle: 'hidden'` +
      // `titleBarOverlay` is Electron's supported cross-platform
      // equivalent of macOS's hiddenInset: it keeps real, OS-drawn
      // minimize/maximize/close buttons (rendered top-right, unlike
      // macOS's top-left traffic lights — App.tsx's titlebar reserves
      // space on the correct side per platform), just themed and
      // positioned to sit inside the custom title bar instead of a
      // full native one. Colors match styles.css's --color-bg-elevated
      // (the titlebar's own background) / --color-text-muted exactly,
      // not guessed. UNVERIFIED: no Windows/Linux machine to visually
      // confirm this against — see WCs/WC__project-status.md.
      {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: { color: '#1a1a1e', symbolColor: '#9a9aa4', height: 52 },
      };

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // claude.md: "Build and test against a minimum window width of
    // 1200px" — this is the actual enforcement of that decision. The
    // renderer has no responsive/narrow-viewport layout (fixed w-72
    // sidebar + a detail pane), so letting the window shrink below
    // this would produce a broken, unusable layout, not a degraded one.
    minWidth: 1200,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...windowFrameOptions,
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
