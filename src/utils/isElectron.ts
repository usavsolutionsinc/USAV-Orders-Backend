/**
 * Returns true when the React app is running inside the Electron desktop shell.
 * Both the legacy `window.desktopApp` and the newer `window.electronAPI` surfaces
 * are checked so this works regardless of which preload version is active.
 */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    !!(window as Window & { desktopApp?: { isElectron?: boolean } }).desktopApp?.isElectron ||
    !!(window as Window & { electronAPI?: unknown }).electronAPI
  );
}

/**
 * The base URL of the local Express sidecar.
 * Falls back to the default port when running outside Electron.
 */
export function getSidecarUrl(): string {
  if (typeof window !== 'undefined') {
    const w = window as Window & { electronAPI?: { sidecarUrl?: string } };
    if (w.electronAPI?.sidecarUrl) return w.electronAPI.sidecarUrl;
  }
  return 'http://localhost:3001';
}

/**
 * Current platform string exposed by the preload script.
 * Returns null when running in a browser (non-Electron) context.
 */
export function getElectronPlatform(): 'darwin' | 'win32' | 'linux' | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { electronAPI?: { platform?: string }; desktopApp?: { platform?: string } };
  const p = w.electronAPI?.platform ?? w.desktopApp?.platform;
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  return null;
}
