const { contextBridge, ipcRenderer } = require('electron');

// Legacy surface — keep for backwards compat with existing code
contextBridge.exposeInMainWorld('desktopApp', {
  isElectron: true,
  platform: process.platform,
});

// Full electronAPI surface — used by new components (EmbeddedBrowser, DocxUploader, etc.)
contextBridge.exposeInMainWorld('electronAPI', {
  // Printing — delegates to native lp (macOS) or PowerShell (Windows)
  printFile: (filePath) => ipcRenderer.invoke('print-file', filePath),

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
});
