const { app, BrowserWindow, Menu, shell } = require('electron');

const DEFAULT_URL = 'https://usav-orders-backend.vercel.app';
const DEV_URL = 'http://127.0.0.1:3000';

function getStartUrl() {
  const configuredUrl = process.env.ELECTRON_START_URL || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_URL;
  return configuredUrl.replace(/\/+$/, '');
}

function getAllowedOrigins(startUrl) {
  return new Set([
    new URL(startUrl).origin,
    new URL(DEFAULT_URL).origin,
    new URL(DEV_URL).origin,
  ]);
}

function createMenu(mainWindow) {
  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.reload(),
        },
        {
          label: 'Open In Browser',
          click: async () => {
            await shell.openExternal(mainWindow.webContents.getURL());
          },
        },
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

function createWindow() {
  const startUrl = getStartUrl();
  const allowedOrigins = getAllowedOrigins(startUrl);

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: false,
    title: 'USAV Orders',
    webPreferences: {
      preload: require.resolve('./preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  createMenu(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const targetUrl = new URL(url);
    if (allowedOrigins.has(targetUrl.origin)) {
      return { action: 'allow' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const targetUrl = new URL(url);
    if (allowedOrigins.has(targetUrl.origin)) {
      return;
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
