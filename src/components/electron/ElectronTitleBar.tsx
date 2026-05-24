'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const HEADER_HEIGHT = 36;
const MAC_TRAFFIC_LIGHTS_INSET = 78;
const DEFAULT_WIN_CONTROL_INSET = 140;

type WindowControlsOverlay = {
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (event: 'geometrychange', cb: () => void) => void;
  removeEventListener: (event: 'geometrychange', cb: () => void) => void;
  visible: boolean;
};

type DesktopAppShim = { isElectron?: boolean; platform?: string };

/**
 * Visible, draggable title bar for the Electron shell. Only mounts inside
 * Electron — in a browser tab it returns null and adds no padding.
 *
 * Cross-platform behavior:
 *  • macOS — `titleBarStyle: 'hiddenInset'` in main.js leaves the traffic
 *    lights inset top-left. We pad the bar 78px on the left so they remain
 *    clickable.
 *  • Windows — `titleBarStyle: 'hidden'` + `titleBarOverlay` paints the
 *    native min/max/close buttons in the top-right. We read the overlay's
 *    titlebar-area rect via `navigator.windowControlsOverlay` and pad the
 *    right side so our content doesn't slide under them.
 *  • Linux — falls back to native chrome; this bar still renders as a
 *    secondary header. (Native window controls handle dragging there.)
 *
 * The bar itself is the drag region (`-webkit-app-region: drag`). Add
 * `WebkitAppRegion: 'no-drag'` to any child you want clickable.
 */
export function ElectronTitleBar() {
  const [isElectron, setIsElectron] = useState(false);
  const [platform, setPlatform] = useState<'darwin' | 'win32' | 'linux' | null>(null);
  const [winControlInset, setWinControlInset] = useState(DEFAULT_WIN_CONTROL_INSET);
  const [pageTitle, setPageTitle] = useState('');
  const pathname = usePathname();

  // Detect Electron + platform, set up window-controls-overlay listener,
  // pad the body so content doesn't slide under the bar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const electron = (window as Window & { desktopApp?: DesktopAppShim }).desktopApp;
    if (!electron?.isElectron) return;

    setIsElectron(true);
    const p = (electron.platform as 'darwin' | 'win32' | 'linux') || 'linux';
    setPlatform(p);

    // Push the app's content down so the bar doesn't cover it. The body has
    // `height: 100vh; overflow: hidden` already — flipping to border-box
    // makes padding-top subtract from the inner area rather than overflow.
    const prevBoxSizing = document.body.style.boxSizing;
    const prevPaddingTop = document.body.style.paddingTop;
    document.body.style.boxSizing = 'border-box';
    document.body.style.paddingTop = `${HEADER_HEIGHT}px`;
    document.documentElement.style.setProperty('--electron-titlebar-height', `${HEADER_HEIGHT}px`);
    // Stamp a hook on <html> so global CSS can offset fixed top-anchored
    // overlays (detail panels, modals, drawers) below the title bar without
    // every component having to know about it.
    document.documentElement.dataset.electronShell = 'true';

    let cleanupWco: (() => void) | undefined;
    if (p === 'win32') {
      const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
        .windowControlsOverlay;
      if (wco) {
        const measure = () => {
          try {
            const rect = wco.getTitlebarAreaRect();
            // titlebar-area rect's right edge is where the native controls
            // begin. The inset is from that edge to the window's right edge.
            const inset = Math.max(0, window.innerWidth - rect.right);
            setWinControlInset(inset || DEFAULT_WIN_CONTROL_INSET);
          } catch {
            setWinControlInset(DEFAULT_WIN_CONTROL_INSET);
          }
        };
        measure();
        wco.addEventListener('geometrychange', measure);
        window.addEventListener('resize', measure);
        cleanupWco = () => {
          wco.removeEventListener('geometrychange', measure);
          window.removeEventListener('resize', measure);
        };
      }
    }

    return () => {
      document.body.style.boxSizing = prevBoxSizing;
      document.body.style.paddingTop = prevPaddingTop;
      document.documentElement.style.removeProperty('--electron-titlebar-height');
      delete document.documentElement.dataset.electronShell;
      cleanupWco?.();
    };
  }, []);

  // Keep the centered title in sync with the route. Falls back to whatever
  // the page sets on document.title.
  useEffect(() => {
    if (!isElectron) return;
    // Defer one frame so client routing has had a chance to set document.title
    const id = requestAnimationFrame(() => {
      const docTitle = document.title?.replace(/^USAV( Solutions| Orders)?\s*[—–-]?\s*/i, '').trim();
      setPageTitle(docTitle || deriveTitleFromPath(pathname));
    });
    return () => cancelAnimationFrame(id);
  }, [isElectron, pathname]);

  if (!isElectron) return null;

  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  const leftInset = isMac ? MAC_TRAFFIC_LIGHTS_INSET : 12;
  const rightInset = isWin ? winControlInset : 12;

  return (
    <div
      role="presentation"
      aria-hidden
      data-titlebar-flush=""
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: HEADER_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: leftInset,
        paddingRight: rightInset,
        background: 'rgba(15, 23, 42, 0.94)',
        color: '#e2e8f0',
        borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
        boxShadow: '0 1px 0 rgba(255, 255, 255, 0.03) inset',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        // Sits above everything so the drag region is always grabbable, even
        // with modals open. Detail panels are responsible for offsetting their
        // top edge by `--electron-titlebar-height` so they don't slide under
        // this bar — see the audit pass that landed the offsets across the
        // panel surface.
        zIndex: 999999,
        userSelect: 'none',
        // @ts-expect-error -- Electron-only CSS prop
        WebkitAppRegion: 'drag',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            color: '#ffffff',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          U
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: '#f1f5f9',
          }}
        >
          USAV Orders
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 16px',
        }}
      >
        <span
          title={pageTitle}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: '#94a3b8',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {pageTitle}
        </span>
      </div>

      {/* Right slot — kept empty for now so the layout balances against the
          left brand block. On Windows the native overlay paints controls
          here; on macOS this gutter mirrors the traffic-light inset. */}
      <div style={{ width: isMac ? MAC_TRAFFIC_LIGHTS_INSET : 0, flex: '0 0 auto' }} />
    </div>
  );
}

function deriveTitleFromPath(pathname: string): string {
  if (!pathname || pathname === '/') return 'Dashboard';
  const parts = pathname.split('/').filter(Boolean);
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/-/g, ' '))
    .join(' › ');
}

export default ElectronTitleBar;
