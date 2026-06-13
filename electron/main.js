const { app, BrowserWindow, Menu, shell, ipcMain, session, dialog } = require('electron');
const path = require('path');

// File logger — makes auto-update activity inspectable after the fact instead of
// vanishing into a hidden console. Logs land at:
//   Windows: %AppData%\USAV Orders\logs\main.log
//   macOS:   ~/Library/Logs/USAV Orders/main.log
// Wrapped defensively: a logging dependency must never be able to stop the app
// from launching, so fall back to console if electron-log is unavailable.
let log;
try {
  log = require('electron-log/main');
  log.initialize();
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
} catch (_) {
  log = { info: console.log, warn: console.warn, error: console.error };
}

const DEFAULT_URL = 'https://usav-orders-backend.vercel.app';
const DEV_URL = 'http://127.0.0.1:3000';
const SIDECAR_PORT = 3001;

const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_START_URL;

// ---------------------------------------------------------------------------
// Performance: GPU + renderer flags — must be set before app is ready
// ---------------------------------------------------------------------------
// Keep hardware acceleration on (it's the default, but be explicit)
app.disableHardwareAcceleration === undefined; // no-op guard
// Smooth scrolling and GPU compositing
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// Use a persistent disk cache so Vercel assets (JS chunks, CSS, fonts) are
// cached between launches — dramatically speeds up every load after the first.
app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024)); // 256 MB

let mainWindow;
let sidecarStarted = false;

// ---------------------------------------------------------------------------
// Sidecar server — local Express API for .docx upload / storage / print
// ---------------------------------------------------------------------------
async function startSidecar() {
  if (sidecarStarted) return;
  try {
    const { startServer } = require('../server/index');
    await startServer(SIDECAR_PORT);
    sidecarStarted = true;
  } catch (err) {
    console.error('[sidecar] Failed to start:', err.message);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  const { printFile } = require('./printer');

  ipcMain.handle('print-file', async (_event, filePath) => {
    try {
      await printFile(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-file', async (_event, filePath) => {
    try {
      await shell.openPath(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // -------------------------------------------------------------------------
  // Silent printing — renders HTML in a hidden BrowserWindow and prints to
  // the given device with no dialog. Used for label / receipt printing.
  // -------------------------------------------------------------------------
  ipcMain.handle('list-printers', async () => {
    try {
      const wc = mainWindow?.webContents;
      if (!wc) return [];
      const printers = await wc.getPrintersAsync();
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault: !!p.isDefault,
        status: p.status,
      }));
    } catch (err) {
      console.error('[print] list-printers failed:', err.message);
      return [];
    }
  });

  ipcMain.handle('print-html', async (_event, { html, options = {} } = {}) => {
    if (typeof html !== 'string' || !html.trim()) {
      return { success: false, reason: 'no html provided' };
    }

    return new Promise((resolve) => {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          if (!printWin.isDestroyed()) printWin.destroy();
        } catch (_) {}
        resolve(result);
      };

      printWin.webContents.once('did-fail-load', (_e, code, desc) => {
        finish({ success: false, reason: `load failed: ${desc} (${code})` });
      });

      // Our label/report HTML embeds `window.onload -> window.print()` so the
      // BROWSER fallback (popup) can drive its own printing. Inside this hidden
      // silent-print window that same call would pop the Windows print dialog
      // before we run webContents.print({ silent: true }) against the configured
      // printer. Neutralize the page's print as soon as the DOM is ready — the
      // embedded call is delayed ~120ms, so this always lands first and only the
      // controlled silent print to the saved device runs.
      printWin.webContents.once('dom-ready', () => {
        printWin.webContents
          .executeJavaScript('window.print = function () {};')
          .catch(() => {});
      });

      printWin.webContents.once('did-finish-load', () => {
        // Give in-page scripts (JsBarcode, web fonts, etc.) a moment to render
        const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 450;
        setTimeout(() => {
          try {
            const printOptions = {
              silent: true,
              printBackground: options.printBackground !== false,
              copies: Math.max(1, Number(options.copies) || 1),
              margins: options.margins || { marginType: 'none' },
              color: options.color !== false,
              landscape: !!options.landscape,
            };
            if (options.deviceName) printOptions.deviceName = options.deviceName;
            if (options.pageSize) printOptions.pageSize = options.pageSize;
            if (Number.isFinite(options.scaleFactor)) printOptions.scaleFactor = options.scaleFactor;
            if (Number.isFinite(options.dpi?.horizontal) && Number.isFinite(options.dpi?.vertical)) {
              printOptions.dpi = options.dpi;
            }

            printWin.webContents.print(printOptions, (success, reason) => {
              finish({ success, reason: reason ?? null });
            });
          } catch (err) {
            finish({ success: false, reason: err.message });
          }
        }, waitMs);
      });

      const dataUrl =
        'data:text/html;charset=utf-8;base64,' +
        Buffer.from(html, 'utf8').toString('base64');
      printWin.loadURL(dataUrl).catch((err) => finish({ success: false, reason: err.message }));
    });
  });
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function getStartUrl() {
  const configured = process.env.ELECTRON_START_URL || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_URL;
  return configured.replace(/\/+$/, '');
}

function getAllowedOrigins(startUrl) {
  return new Set([
    new URL(startUrl).origin,
    new URL(DEFAULT_URL).origin,
    new URL(DEV_URL).origin,
    `http://localhost:${SIDECAR_PORT}`,
    `http://127.0.0.1:${SIDECAR_PORT}`,
  ]);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function createMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    // macOS expects the app menu as the first item; without it, the standard
    // Cmd+Q / Hide / About items are missing.
    ...(isMac
      ? [
          {
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
          },
        ]
      : []),
    // Edit submenu — role-based items use Electron's built-in clipboard
    // routing, which forwards Cmd/Ctrl+C/V/X to the *focused element* even
    // when that element lives inside a <webview> (e.g. the Zoho login form
    // pasted into the embedded browser pane). Without this menu, accelerators
    // never reach the guest page on macOS.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.webContents.reload(),
        },
        {
          label: 'Open In Browser',
          click: async () => shell.openExternal(win.webContents.getURL()),
        },
        ...(isDev
          ? [
              {
                label: 'Toggle DevTools',
                accelerator: 'CmdOrCtrl+Shift+I',
                click: () => win.webContents.toggleDevTools(),
              },
            ]
          : []),
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function createWindow() {
  const startUrl = getStartUrl();
  const allowedOrigins = getAllowedOrigins(startUrl);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'USAV Orders',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,               // must be false to use contextBridge with ipcRenderer
      webviewTag: true,             // enables <webview> in the renderer (embedded browser panels)
      devTools: true,
      backgroundThrottling: false,  // don't throttle timers/rendering when window loses focus
    },
  });

  createMenu(mainWindow);

  // Allow same-origin popup windows; send everything else to the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (allowedOrigins.has(origin)) return { action: 'allow' };
    } catch (_) {
      // ignore invalid URLs
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const origin = new URL(url).origin;
      if (allowedOrigins.has(origin)) return;
    } catch (_) {
      // ignore
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.webContents.on('did-fail-load', () => {
    const retryUrl = startUrl.replace(/"/g, '&quot;');
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
          <div style="max-width:520px; padding:32px; border:1px solid rgba(148,163,184,.25); border-radius:18px; background:rgba(15,23,42,.92); box-shadow:0 20px 60px rgba(0,0,0,.35);">
            <h1 style="margin:0 0 12px; font-size:24px;">USAV Orders is unavailable</h1>
            <p style="margin:0 0 20px; line-height:1.5; color:#cbd5e1;">
              The desktop shell could not load the configured app URL. Check network access or confirm the target site is online.
            </p>
            <p style="margin:0 0 24px; padding:12px 14px; border-radius:12px; background:#111827; color:#93c5fd; word-break:break-all;">
              ${retryUrl}
            </p>
            <button onclick="location.href='${retryUrl}'" style="border:0; border-radius:999px; padding:12px 18px; font-weight:600; background:#2563eb; color:white; cursor:pointer;">
              Retry
            </button>
          </div>
        </body>
      </html>`
    );
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(startUrl);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  try {
    await session.defaultSession.clearCache().catch(() => {});

    await startSidecar();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {
    // Never let an unexpected error stop the window from showing — the user
    // ends up staring at a headless process otherwise. Log and try anyway.
    console.error('[startup] unexpected error:', err);
    try { registerIpcHandlers(); } catch (_) {}
    try { createWindow(); } catch (e2) { console.error('[startup] createWindow failed:', e2); }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Auto-updater — checks GitHub Releases silently on launch.
// Only runs in a packaged build (not dev mode) to avoid noisy errors.
//
// Skipped on legacy Electron builds (the macOS 10.x Intel installer ships on
// Electron 22). The published auto-update target is built with current
// Electron and won't launch on macOS 10.x, so pulling it would brick the app.
// ---------------------------------------------------------------------------
const electronMajor = parseInt((process.versions.electron || '0').split('.')[0], 10) || 0;
const isLegacyElectron = electronMajor > 0 && electronMajor < 23;

if (!isDev && !isLegacyElectron) {
  try {
    const { autoUpdater } = require('electron-updater');

    // Send every updater event to the file logger so a maintainer can confirm
    // the update flow ran (checking → available → downloaded) or read the exact
    // failure reason — see the log paths noted at the top of this file.
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;       // download in background automatically
    autoUpdater.autoInstallOnAppQuit = true; // install when the user next quits

    log.info(`[updater] app v${app.getVersion()} — will check GitHub Releases for a newer build`);

    autoUpdater.on('checking-for-update', () => log.info('[updater] checking for update…'));
    autoUpdater.on('update-available', (info) =>
      log.info(`[updater] update available: v${info && info.version} — downloading in background`));
    autoUpdater.on('update-not-available', (info) =>
      log.info(`[updater] no update — v${(info && info.version) || app.getVersion()} is already latest`));
    autoUpdater.on('download-progress', (p) =>
      log.info(`[updater] downloading ${Math.round((p && p.percent) || 0)}%`));

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`[updater] downloaded v${info && info.version} — prompting restart`);
      // Prompt the user to restart and apply the update now, or wait
      dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `USAV Orders ${info.version} has been downloaded.`,
        detail: 'Restart now to apply the update, or it will install automatically next time you quit.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      // Don't interrupt the user, but record the full reason for diagnosis.
      log.error('[updater] error:', err == null ? 'unknown' : (err.stack || err.message || String(err)));
    });

    // Check 3 seconds after launch so startup isn't delayed
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) =>
        log.error('[updater] checkForUpdates failed:', (err && err.message) || err));
    }, 3000);
  } catch (err) {
    log.error('[updater] init failed:', (err && err.message) || err);
  }
}
