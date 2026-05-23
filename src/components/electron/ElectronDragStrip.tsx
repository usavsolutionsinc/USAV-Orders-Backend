'use client';

import { useEffect, useState } from 'react';

/**
 * Invisible draggable strip pinned to the top of the window. Only mounts
 * inside the Electron shell — in a browser tab it returns null.
 *
 * The BrowserWindow uses `titleBarStyle: 'hiddenInset'` (no native title bar),
 * which means content reaches y=0 with no built-in drag region. This strip
 * provides one. macOS draws the traffic-light buttons on top, so we leave a
 * gap on the left to keep them clickable.
 *
 * `WebkitAppRegion: 'drag'` intercepts mousedown for window movement. The
 * element MUST receive pointer events for that to work — `pointer-events: none`
 * silently disables the drag region. Any clickable UI rendered into the top
 * 28px must opt out individually with `WebkitAppRegion: 'no-drag'`.
 */
export function ElectronDragStrip() {
  const [isElectron, setIsElectron] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const electron = Boolean(
      (window as Window & { desktopApp?: { isElectron?: boolean } })
        .desktopApp?.isElectron,
    );
    setIsElectron(electron);
    setIsMac(/Mac|iPhone|iPod|iPad/.test(navigator.platform));
  }, []);

  if (!isElectron) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        // Leave room for the macOS traffic-light buttons (~78px), otherwise
        // the drag region swallows their clicks.
        left: isMac ? 78 : 0,
        right: 0,
        height: 28,
        // @ts-expect-error -- WebkitAppRegion is an Electron-only CSS prop
        WebkitAppRegion: 'drag',
        zIndex: 999999,
      }}
    />
  );
}
