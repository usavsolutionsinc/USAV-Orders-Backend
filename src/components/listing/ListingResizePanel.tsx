'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import EmbeddedBrowser from '@/components/EmbeddedBrowser';
import { Button, IconButton } from '@/design-system/primitives';
import { ChevronDown, ExternalLink } from '@/components/Icons';

/* ─────────────────────────────────────────────────────────────────────────
 *  ListingResizePanel
 *  ───────────────────────────────────────────────────────────────────────
 *  Pinned iframe section with a draggable splitter on top. Click-and-hold
 *  the splitter to resize the iframe; operators drag it taller to clear
 *  cookie banners or external modals.
 *
 *  Interaction:
 *   • Drag up   → iframe grows (content above gets less room).
 *   • Drag down → iframe shrinks. Past a collapse threshold it snaps closed.
 *   • Double-click → toggles "max" (≈ viewport-200px) and "default" (≈55vh).
 *   • Chevron button → fully collapse / restore.
 *   • Keyboard: ↑/↓ resize, Home/End jump to extremes, Enter/Space toggle.
 *
 *  Height + collapsed state persist in localStorage under the supplied
 *  `storageNamespace` so each surface (tech station, product pairing, etc.)
 *  remembers its own sizing.
 *  ─────────────────────────────────────────────────────────────────── */

const COLLAPSE_DRAG_THRESHOLD = 80;
const MIN_OPEN_HEIGHT = 160;

export interface ListingResizePanelProps {
  url: string;
  /** When false, panel shows an "open externally" fallback instead of the webview. */
  canEmbed: boolean;
  /** Header strip label. Defaults to "Listing preview". */
  title?: string;
  /** localStorage namespace; height/collapsed persist per surface. */
  storageNamespace: string;
}

function getInitialHeight(ns: string): number {
  if (typeof window === 'undefined') return 480;
  try {
    const stored = window.localStorage.getItem(`${ns}.listingPanel.heightPx`);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_OPEN_HEIGHT) return parsed;
  } catch { /* noop */ }
  return Math.max(360, Math.floor(window.innerHeight * 0.55));
}

function getInitialCollapsed(ns: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`${ns}.listingPanel.collapsed`) === '1';
  } catch { return false; }
}

export function ListingResizePanel({
  url,
  canEmbed,
  title = 'Listing preview',
  storageNamespace,
}: ListingResizePanelProps) {
  const heightKey = `${storageNamespace}.listingPanel.heightPx`;
  const collapsedKey = `${storageNamespace}.listingPanel.collapsed`;

  const [height, setHeight] = useState<number>(() => getInitialHeight(storageNamespace));
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => getInitialCollapsed(storageNamespace));
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (isCollapsed) return;
    try { window.localStorage.setItem(heightKey, String(height)); } catch { /* noop */ }
  }, [height, isCollapsed, heightKey]);

  useEffect(() => {
    try { window.localStorage.setItem(collapsedKey, isCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [isCollapsed, collapsedKey]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startHeight: isCollapsed ? MIN_OPEN_HEIGHT : height,
    };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  }, [height, isCollapsed]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    // Inverted axis: dragging up (smaller clientY) grows the iframe.
    const delta = dragRef.current.startY - e.clientY;
    const next = dragRef.current.startHeight + delta;
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    if (next < COLLAPSE_DRAG_THRESHOLD) {
      setIsCollapsed(true);
    } else {
      setIsCollapsed(false);
      setHeight(Math.min(Math.max(next, MIN_OPEN_HEIGHT), maxH));
    }
  }, []);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const handleDoubleClick = useCallback(() => {
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    const defaultH = Math.floor(window.innerHeight * 0.55);
    if (isCollapsed) {
      setIsCollapsed(false);
      setHeight(defaultH);
      return;
    }
    setHeight((prev) => (prev >= maxH - 20 ? defaultH : maxH));
  }, [isCollapsed]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsCollapsed(false);
      setHeight((h) => Math.min(h + step, maxH));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHeight((h) => Math.max(h - step, MIN_OPEN_HEIGHT));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIsCollapsed(false);
      setHeight(maxH);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIsCollapsed(true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsCollapsed((c) => !c);
    }
  }, []);

  const effectiveHeight = isCollapsed ? 0 : height;

  return (
    <div className="flex-none border-t border-gray-200 bg-white">
      {/* Splitter — drag region. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize listing panel (drag, or arrow keys)"
        aria-valuenow={effectiveHeight}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={`group/grip relative flex h-2.5 cursor-row-resize items-center justify-center border-b border-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
          isDragging ? 'bg-blue-100' : 'bg-gray-50 hover:bg-blue-50'
        }`}
      >
        <span
          className={`h-[3px] w-10 rounded-full transition-colors ${
            isDragging ? 'bg-blue-500' : 'bg-gray-300 group-hover/grip:bg-blue-400'
          }`}
        />
      </div>

      {/* Title strip — outside the drag region so buttons stay clickable. */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-micro font-black uppercase tracking-widest text-gray-500">
          <ExternalLink className="h-3 w-3 shrink-0 text-blue-500" />
          <span className="truncate">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="h-auto px-0 text-micro font-bold text-blue-600 hover:bg-transparent hover:text-blue-800"
          >
            Open externally
          </Button>
          <IconButton
            icon={
              <ChevronDown
                className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
              />
            }
            ariaLabel={isCollapsed ? 'Expand listing' : 'Collapse listing'}
            onClick={() => setIsCollapsed((c) => !c)}
            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          />
        </div>
      </div>

      {/* Iframe body */}
      <div
        style={{ height: `${effectiveHeight}px` }}
        className={`overflow-hidden bg-white ${
          isDragging ? '' : 'transition-[height] duration-200 ease-out'
        }`}
      >
        {effectiveHeight > 0 ? (
          canEmbed ? (
            <div className="h-full">
              <EmbeddedBrowser url={url} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 py-10 text-center">
              <p className="text-label font-semibold text-gray-500">
                Listing preview is only available in the desktop app. Use{' '}
                {/* ds-raw-button — inline prose link */}
                <button
                  type="button"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="text-blue-600 underline-offset-2 hover:underline"
                >
                  Open externally
                </button>{' '}
                to view the page in a browser tab.
              </p>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
