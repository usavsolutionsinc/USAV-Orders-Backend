'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import EmbeddedBrowser from '@/components/EmbeddedBrowser';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';

type OpenPaneDetail = { poId?: string; poNumber?: string };

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 320;
const MAX_WIDTH_PAD = 240; // keep at least this many px of main content visible
const WIDTH_STORAGE_KEY = 'zoho-pane-width';

function buildZohoUrl(detail: OpenPaneDetail): string {
  const poId = (detail.poId || '').trim();
  const poNumber = (detail.poNumber || '').trim();
  if (poId) {
    return `https://inventory.zoho.com/app#/purchaseorders/${encodeURIComponent(poId)}`;
  }
  if (poNumber) {
    return `https://inventory.zoho.com/app#/purchaseorders?search_text=${encodeURIComponent(poNumber)}`;
  }
  return 'https://inventory.zoho.com/app#/purchaseorders';
}

/**
 * Right-side overlay that mounts the Zoho Inventory web UI inside the Electron
 * shell (`<webview>` — bypasses X-Frame-Options). Hidden by default. The flow-
 * header "Open in Zoho" action dispatches `open-zoho-pane` with the PO id /
 * number; this component listens and reveals the pane.
 *
 * The pane has a draggable left edge; width is persisted across sessions.
 * In a regular browser tab (no Electron), the event is ignored so the action
 * falls back to its `window.open` behavior.
 */
export function ZohoSplitPane() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isElectron, setIsElectron] = useState(false);
  const widthRef = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    setIsElectron(
      typeof window !== 'undefined' &&
        Boolean(
          (window as Window & { desktopApp?: { isElectron?: boolean } })
            .desktopApp?.isElectron,
        ),
    );
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH) {
      const cap = Math.max(MIN_WIDTH, window.innerWidth - MAX_WIDTH_PAD);
      const next = Math.min(stored, cap);
      setWidth(next);
      widthRef.current = next;
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      // Tell the dispatcher the pane handled this — caller does NOT fall
      // back to window.open. Browser users get the "open externally" link
      // inside the pane instead.
      e.preventDefault();
      const detail = ((e as CustomEvent).detail || {}) as OpenPaneDetail;
      setUrl(buildZohoUrl(detail));
      setOpen(true);
    };
    window.addEventListener('open-zoho-pane', handler);
    return () => window.removeEventListener('open-zoho-pane', handler);
  }, []);

  const onDragStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const onMove = (ev: MouseEvent) => {
        const cap = Math.max(MIN_WIDTH, window.innerWidth - MAX_WIDTH_PAD);
        const next = Math.max(
          MIN_WIDTH,
          Math.min(cap, startWidth - (ev.clientX - startX)),
        );
        widthRef.current = next;
        setWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
        } catch {
          /* private mode / storage disabled */
        }
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [],
  );

  if (!open || !url) return null;

  return (
    <aside
      className="fixed right-0 top-0 z-40 flex h-full flex-col border-l border-border-soft bg-surface-card shadow-[0_0_24px_-12px_rgba(15,23,42,0.35)]"
      style={{ width }}
      role="complementary"
      aria-label="Zoho PO viewer"
    >
      <div
        onMouseDown={onDragStart}
        className="absolute -left-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-blue-400/40 active:bg-blue-500/60"
        role="separator"
        aria-label="Resize Zoho pane"
        aria-orientation="vertical"
      />

      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-hairline bg-surface-canvas px-3">
        <span className="text-caption font-black uppercase tracking-[0.18em] text-text-muted">
          Zoho · Purchase Order
        </span>
        <IconButton
          onClick={() => setOpen(false)}
          ariaLabel="Close Zoho pane"
          icon={<X className="h-4 w-4" />}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-strong"
        />
      </header>

      <div className="min-h-0 flex-1">
        {isElectron ? (
          <EmbeddedBrowser url={url} className="h-full" />
        ) : (
          // Browser tab fallback — Zoho blocks iframe embedding, so we surface
          // the same "open externally" affordance the rest of the receiving
          // workspace uses (see the LISTING PREVIEW card).
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-label text-text-soft">
            <p className="leading-snug">
              Embedded Zoho is only available in the desktop app.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-caption font-black uppercase tracking-[0.16em] text-white hover:bg-blue-700"
            >
              Open in Zoho
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
