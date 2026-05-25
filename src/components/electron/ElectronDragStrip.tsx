'use client';

import { useEffect, useState } from 'react';

const STRIP_HEIGHT = 36;
const STRIP_BACKGROUND = '#2d2d2d'; // medium-dark neutral grey
const MAC_TRAFFIC_LIGHTS_INSET = 78;

/**
 * Visible draggable strip pinned to the top of the window. Only mounts
 * inside the Electron shell — in a browser tab it returns null.
 *
 * Renders as a plain black band across the full window width with no text
 * or controls; its only job is to give the user something to grab when they
 * want to move the window. On macOS it leaves room on the left for the
 * traffic-light buttons (which the OS paints on top of the strip).
 *
 * Body content is pushed down by the strip's height while this is mounted
 * so the app's first row doesn't slide under the strip and lose its top
 * edge. The padding is removed on unmount.
 *
 * `WebkitAppRegion: 'drag'` intercepts mousedown for window movement. The
 * element MUST receive pointer events for that to work — `pointer-events: none`
 * silently disables the drag region.
 */
export function ElectronDragStrip() {
  const [showStrip, setShowStrip] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const electron = Boolean(
      (window as Window & { desktopApp?: { isElectron?: boolean } })
        .desktopApp?.isElectron,
    );
    const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform);
    // Only mac needs the custom strip — Windows/Linux use the native window chrome.
    const enabled = electron && isMac;
    setShowStrip(enabled);

    if (!enabled) return;

    document.documentElement.classList.add('electron-shell');
    document.documentElement.style.setProperty('--electron-titlebar-height', `${STRIP_HEIGHT}px`);

    return () => {
      document.documentElement.classList.remove('electron-shell');
      document.documentElement.style.removeProperty('--electron-titlebar-height');
    };
  }, []);

  if (!showStrip) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: STRIP_HEIGHT,
        background: STRIP_BACKGROUND,
        paddingLeft: MAC_TRAFFIC_LIGHTS_INSET,
        zIndex: 999999,
        // @ts-expect-error -- WebkitAppRegion is an Electron-only CSS prop
        WebkitAppRegion: 'drag',
      }}
    />
  );
}
