const { contextBridge, ipcRenderer } = require('electron');

// Legacy surface — keep for backwards compat with existing code
contextBridge.exposeInMainWorld('desktopApp', {
  isElectron: true,
  platform: process.platform,
});

// Full electronAPI surface — used by new components (EmbeddedBrowser, DocxUploader, etc.)
contextBridge.exposeInMainWorld('electronAPI', {
  // Flag callers can sniff to decide between silent print path and browser fallback
  isElectron: true,

  // Printing — delegates to native lp (macOS) or PowerShell (Windows)
  printFile: (filePath) => ipcRenderer.invoke('print-file', filePath),

  // Silent HTML printing — renders the HTML in a hidden window and prints to
  // the chosen device (or system default) with no dialog. Returns
  // { success: boolean, reason: string | null }.
  printHtml: (html, options = {}) => ipcRenderer.invoke('print-html', { html, options }),

  // Returns the list of installed printers as { name, displayName, isDefault, ... }
  listPrinters: () => ipcRenderer.invoke('list-printers'),

  // Open a file with the default OS application
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // Platform string: 'darwin' | 'win32' | 'linux'
  platform: process.platform,

  // Subscribe to print-complete events pushed from the main process
  onPrintComplete: (cb) => {
    const listener = (_event, ...args) => cb(...args);
    ipcRenderer.on('print-complete', listener);
    return () => ipcRenderer.removeListener('print-complete', listener);
  },

  // Sidecar base URL for React components that talk to the local Express server
  sidecarUrl: 'http://localhost:3001',

  // Build / runtime info — surfaced in the Settings → About section
  appInfo: {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },
});
