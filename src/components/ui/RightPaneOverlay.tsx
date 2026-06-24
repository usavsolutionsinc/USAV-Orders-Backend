'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { cn } from '@/utils/_cn';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';

// ─── Host ─────────────────────────────────────────────────────────────────────
// Marks the right-pane content column as the anchor for every `RightPaneOverlay`
// rendered beneath it. The overlay reads this element from context and pins its
// panel over the element's on-screen rect — so pane-focused surfaces (audit log,
// NAS picker, detail slide-overs) land on the right panel, while the backdrop
// still dims the whole viewport (sidebar + header included).

const RightPaneHostContext = createContext<HTMLElement | null>(null);

export function RightPaneOverlayHost({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // Ref-as-state so consumers re-render once the host element is mounted and the
  // context value flips from null → element.
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <RightPaneHostContext.Provider value={host}>
      <div ref={setHost} className={cn('relative', className)}>
        {children}
      </div>
    </RightPaneHostContext.Provider>
  );
}

/** The nearest right-pane host element, or null when rendered outside a host. */
export function useRightPaneHost(): HTMLElement | null {
  return useContext(RightPaneHostContext);
}

// ─── Overlay shell ──────────────────────────────────────────────────────────────

const SPRING = { type: 'spring', stiffness: 350, damping: 28, mass: 0.6 } as const;
const FADE = { duration: 0.16, ease: motionBezier.easeOut } as const;

export type RightPaneOverlayAlign = 'center' | 'right';

interface RightPaneOverlayProps {
  open: boolean;
  onClose: () => void;
  /**
   * center → card centred over the pane (audit log, NAS picker).
   * right  → full-height slide-over from the pane's right edge (detail panels).
   */
  align?: RightPaneOverlayAlign;
  /**
   * pane (default) → pin over the nearest {@link RightPaneOverlayHost}'s rect, so
   * the surface sits inside the right content column (below the global header).
   * viewport → ignore any host and span the full viewport, so an `align="right"`
   * drawer runs top-to-bottom over the global header too (the audit log).
   */
  anchor?: 'pane' | 'viewport';
  /** Slide-over width in px for `align="right"`. Ignored for `center`. */
  width?: number;
  /** Dim + click-to-close layer. Covers the WHOLE viewport (sidebar + header). Default true. */
  backdrop?: boolean;
  /** Lock body scroll while open. Default true. */
  lockScroll?: boolean;
  /** Close on Escape. Default true. */
  closeOnEscape?: boolean;
  /** Bottom-right drag-to-resize grip. Center align only. Default false. */
  resizable?: boolean;
  /** localStorage key to persist the resized dimensions across opens. */
  storageKey?: string;
  /** Resize lower clamps in px. */
  minWidth?: number;
  minHeight?: number;
  /** Extra classes on the panel surface (the white card / drawer). */
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * Right-pane-anchored overlay shell.
 *
 * The backdrop dims the entire viewport (everything greys out), while the panel
 * is pinned over the nearest {@link RightPaneOverlayHost}'s rect — so the dialog
 * sits on the right pane, not the centre of the whole screen. With no host
 * mounted (mobile, other routes) it degrades to a normal viewport-centred modal
 * / right drawer.
 *
 * The shell owns chrome only — portal, backdrop, Escape, scroll-lock, motion and
 * the panel surface (white, rounded/bordered, `flex flex-col overflow-hidden`).
 * Compose the header + body as children; a scrollable body should be
 * `min-h-0 flex-1 overflow-y-auto`.
 */
export function RightPaneOverlay({
  open,
  onClose,
  align = 'center',
  anchor = 'pane',
  width = 440,
  backdrop = true,
  lockScroll = true,
  closeOnEscape = true,
  resizable = false,
  storageKey,
  minWidth = 420,
  minHeight = 360,
  className,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: RightPaneOverlayProps) {
  // `anchor="viewport"` opts out of host pinning so the panel fills the whole
  // viewport (rect stays null → full-screen frame below).
  const hostFromContext = useRightPaneHost();
  const host = anchor === 'viewport' ? null : hostFromContext;
  useBodyScrollLock(open && lockScroll);
  useEscapeClose(open && closeOnEscape, onClose);

  // Track the host pane's viewport rect so the panel can sit over it while the
  // backdrop dims the whole screen. useLayoutEffect measures before paint, so
  // the panel never flashes at the fallback (full-viewport) position first.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!open || !host) {
      setRect(null);
      return;
    }
    const measure = () => setRect(host.getBoundingClientRect());
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, host]);

  // ─── Drag-to-resize (center align, opt-in) ──────────────────────────────────
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Hydrate the persisted size when a resizable center overlay opens, clamped to
  // the current viewport so a size saved on a big screen still fits a small one.
  useLayoutEffect(() => {
    if (!open || !resizable || align !== 'center' || !storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown };
      if (typeof parsed.w !== 'number' || typeof parsed.h !== 'number') return;
      const w = Math.max(minWidth, Math.min(parsed.w, window.innerWidth - 24));
      const h = Math.max(minHeight, Math.min(parsed.h, window.innerHeight - 24));
      setSize({ w, h });
    } catch {
      /* ignore malformed persisted size */
    }
  }, [open, resizable, align, storageKey, minWidth, minHeight]);

  const startResize = (e: ReactPointerEvent) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect0 = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const maxW = window.innerWidth - 24;
    const maxH = window.innerHeight - 24;
    let latest = { w: rect0.width, h: rect0.height };
    const onMove = (ev: PointerEvent) => {
      latest = {
        w: Math.max(minWidth, Math.min(maxW, rect0.width + (ev.clientX - startX))),
        h: Math.max(minHeight, Math.min(maxH, rect0.height + (ev.clientY - startY))),
      };
      setSize(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(latest));
        } catch {
          /* ignore quota / disabled storage */
        }
      }
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const target = typeof document !== 'undefined' ? document.body : null;
  if (!target) return null;

  // Positioning frame: sized to the pane rect (or the whole viewport when no
  // host). It's pointer-events-none so backdrop clicks still reach the dim
  // layer; the panel re-enables pointer events. The frame is non-transformed so
  // the panel's framer-motion transform (scale/slide) stays conflict-free.
  // Frame sits one above the backdrop within the panelPopover band.
  const frameStyle: CSSProperties = rect
    ? { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: zLayer.panelPopover + 1 }
    : { position: 'fixed', inset: 0, zIndex: zLayer.panelPopover + 1 };

  const frameClass =
    align === 'right' ? 'flex items-stretch justify-end' : 'flex items-center justify-center p-3';

  const panelMotion =
    align === 'right'
      ? { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' }, transition: SPRING }
      : {
          initial: { opacity: 0, scale: 0.97 },
          animate: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 0.97 },
          transition: FADE,
        };

  const panelClass =
    align === 'right'
      ? 'pointer-events-auto h-full border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)]'
      : 'pointer-events-auto max-h-full w-[min(92%,32rem)] rounded-xl border border-slate-200 shadow-xl';

  // A resized center panel switches to explicit px dims; `none` lifts the
  // className max-* clamps so the operator can grow past the default frame.
  const panelStyle: CSSProperties | undefined =
    align === 'right'
      ? { width }
      : resizable && size
        ? { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none' }
        : undefined;

  return createPortal(
    <AnimatePresence>
      {open && backdrop ? (
        <motion.div
          key="rp-overlay-backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
          onClick={onClose}
          className="fixed inset-0 z-panelPopover bg-gray-950/35 backdrop-blur-[1px]"
        />
      ) : null}
      {open ? (
        <motion.div
          key="rp-overlay-frame"
          initial={false}
          style={frameStyle}
          className={cn('pointer-events-none', frameClass)}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
            style={panelStyle}
            className={cn('relative flex flex-col overflow-hidden bg-white', panelClass, className)}
          >
            {children}
            {resizable && align === 'center' ? (
              <div
                role="presentation"
                aria-hidden
                onPointerDown={startResize}
                title="Drag to resize"
                className="absolute bottom-0 right-0 z-10 flex h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5 text-gray-300 transition-colors hover:text-gray-500"
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                  <path d="M9 3 L3 9 M9 6.5 L6.5 9" />
                </svg>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    target,
  );
}
