const { app, BrowserWindow, Menu, shell, ipcMain, session, dialog } = require('electron');
const path = require('path');

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
  const template = [
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
  // Point the default session's cache at a persistent location under userData
  // so static assets survive between app launches.
  const cachePath = path.join(app.getPath('userData'), 'http-cache');
  await session.defaultSession.clearCache().catch(() => {});
  session.defaultSession.setSpellCheckerDictionaryDownloadURL(''); // silence unrelated warning

  await startSidecar();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Auto-updater — checks GitHub Releases silently on launch.
// Only runs in a packaged build (not dev mode) to avoid noisy errors.
// ---------------------------------------------------------------------------
if (!isDev) {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload = true;       // download in background automatically
    autoUpdater.autoInstallOnAppQuit = true; // install when the user next quits

    autoUpdater.on('update-downloaded', (info) => {
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
      // Log silently — don't interrupt the user for update errors
      console.error('[updater] Error:', err.message);
    });

    // Check 3 seconds after launch so startup isn't delayed
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  } catch (_) {
    // electron-updater not installed yet — skip silently
  }
}
