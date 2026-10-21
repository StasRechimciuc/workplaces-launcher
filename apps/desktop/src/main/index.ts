import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, Notification, Tray, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { PRODUCT_NAME } from '@workspace-launcher/shared/vscode-restore';
import { registerIpcHandlers } from './ipc/handlers';
import { syncHotkeys } from './orchestrator/hotkey-service';
import { settingsStore } from './settings/store';
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
  // The one real-quit chokepoint — see WCs/WC__global-hotkeys.md's
  // tray/background-persistence section. False by default: any quit
  // trigger (Cmd+Q via the app menu's default Quit role, the window's
  // own close button reaching zero windows, a plain `kill <pid>`,
  // anything else that calls app.quit() or sends a quit signal) backs
  // the app off into the tray instead of exiting. The ONLY code that
  // sets this true is the tray menu's own "Quit" item, just before it
  // calls app.quit() itself — deliberately scoped inside this
  // `if (gotSingleInstanceLock)` block (not module-level), so the
  // failed-lock early-exit path above never registers a before-quit
  // handler that could intercept its own already-queued app.quit().
  let isQuittingFromTray = false;
  let tray: Tray | null = null;

  // Someone tried to launch a second instance — focus the existing
  // window instead of letting a second process start.
  app.on('second-instance', () => {
    showOrCreateMainWindow();
  });

  /**
   * Shared by the tray's own click handler, its "Open" menu item, and
   * the second-instance handler above: reuses an existing window if
   * one's still around (windows are destroyed, not hidden, on close —
   * see window-all-closed below — so "existing" usually means the app
   * was never backgrounded yet this launch) rather than always
   * creating a fresh one.
   */
  function showOrCreateMainWindow(): void {
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
      return;
    }
    createMainWindow();
  }

  /**
   * macOS menu-bar icons must be "template images" (monochrome,
   * filename ending in "Template") for the OS to auto-invert them
   * between light/dark menu bars — see resources/tray/'s own PNGs and
   * WCs/WC__global-hotkeys.md for why these are a known placeholder,
   * not final artwork. `is.dev` loads straight from this source tree;
   * a packaged build copies them to `process.resourcesPath` via
   * electron-builder.yml's `extraResources`.
   */
  function getTrayIconPath(): string {
    return is.dev
      ? join(__dirname, '../../resources/tray/trayIconTemplate.png')
      : join(process.resourcesPath, 'tray/trayIconTemplate.png');
  }

  function buildTrayMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: 'Open Workspace Launcher', click: () => showOrCreateMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit Workspace Launcher',
        click: () => {
          isQuittingFromTray = true;
          app.quit();
        },
      },
    ]);
  }

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.workspacelauncher.app');
    Menu.setApplicationMenu(buildAppMenu());

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    registerBuiltInTools();
    registerIpcHandlers();
    createMainWindow();

    tray = new Tray(getTrayIconPath());
    tray.setToolTip(PRODUCT_NAME);
    tray.setContextMenu(buildTrayMenu());
    // Context-menu-on-left-click is already macOS's own default once
    // setContextMenu is called (this platform's actual scope right
    // now) — this handler only matters for a future Windows/Linux
    // build, where left-click doesn't auto-show the context menu.
    if (process.platform !== 'darwin') {
      tray.on('click', () => showOrCreateMainWindow());
    }

    // Registers every stored workspace hotkey as a live global
    // shortcut — see hotkey-service.ts. Deliberately not awaited: a
    // registration failure is reported per-workspace via the Settings
    // UI's "needs to be re-picked" indicator, never a startup-blocking
    // error, and syncHotkeys() itself never throws (each registration
    // attempt is individually try/caught).
    syncHotkeys();

    app.on('activate', () => {
      showOrCreateMainWindow();
    });
  }).catch((err: unknown) => {
    // Mirrors createMainWindow()'s own loadPromise.catch below — an
    // uncaught rejection here (e.g. a future addition to this chain
    // that can throw) would otherwise be a silent, unreported failure
    // with no window and no indication why.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start Workspace Launcher: ${message}`);
    dialog.showErrorBox('Workspace Launcher failed to start', message);
  });

  app.on('window-all-closed', () => {
    // Windows are destroyed, not hidden, on close (createMainWindow has
    // no close-interception of its own) specifically to avoid keeping a
    // full Chromium renderer resident in memory for however long the
    // app sits backgrounded — the founder's own prediction is that this
    // will be a frequently-used, often-backgrounded feature. activate/
    // showOrCreateMainWindow already recreate a window on demand, so
    // nothing is lost besides a brief reload when reopening.
    if (process.platform === 'darwin') {
      app.dock?.hide();
    }

    // Never show this on a genuine tray-initiated quit — window-all-
    // closed still fires on the way to a real exit (Electron's quit
    // order is before-quit -> each window's close -> window-all-closed
    // -> will-quit -> quit), and telling the user "still running in the
    // background" at the exact moment the app is exiting would be
    // actively misleading.
    if (isQuittingFromTray) return;

    if (!settingsStore.get('hasShownBackgroundNotice') && Notification.isSupported()) {
      new Notification({
        title: PRODUCT_NAME,
        body: 'Still running in the menu bar — click the tray icon to reopen, or Quit from there.',
      }).show();
      settingsStore.set('hasShownBackgroundNotice', true);
    }
  });

  // Dev-mode only: electron-vite's own hot-restart-on-file-change
  // sends the running process a real quit — if before-quit intercepted
  // that too (as it correctly does in production, to back the app off
  // into the tray), the old process would never actually exit. It'd
  // stay alive holding the single-instance lock while electron-vite
  // spawns a fresh process for the restart, which immediately loses
  // the lock race and exits, while the OLD zombie process's
  // `second-instance` handler recreates a window against its own
  // now-stale `ELECTRON_RENDERER_URL` — a dev server that's since
  // moved on or died, surfacing as a blank white window with
  // ERR_CONNECTION_REFUSED. Confirmed, not theoretical: hit exactly
  // this during this feature's own build. Production packaging never
  // sends this kind of external restart signal, so this gate only
  // matters for `npm run dev`.
  if (!is.dev) {
    app.on('before-quit', (event) => {
      if (isQuittingFromTray) return; // let the real quit proceed
      event.preventDefault();
      BrowserWindow.getAllWindows().forEach((w) => w.destroy());
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
    });
  }
}
