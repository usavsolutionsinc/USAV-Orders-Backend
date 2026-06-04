'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';

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
const FADE = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const;

export type RightPaneOverlayAlign = 'center' | 'right';

interface RightPaneOverlayProps {
  open: boolean;
  onClose: () => void;
  /**
   * center → card centred over the pane (audit log, NAS picker).
   * right  → full-height slide-over from the pane's right edge (detail panels).
   */
  align?: RightPaneOverlayAlign;
  /** Slide-over width in px for `align="right"`. Ignored for `center`. */
  width?: number;
  /** Dim + click-to-close layer. Covers the WHOLE viewport (sidebar + header). Default true. */
  backdrop?: boolean;
  /** Lock body scroll while open. Default true. */
  lockScroll?: boolean;
  /** Close on Escape. Default true. */
  closeOnEscape?: boolean;
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
  width = 440,
  backdrop = true,
  lockScroll = true,
  closeOnEscape = true,
  className,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: RightPaneOverlayProps) {
  const host = useRightPaneHost();
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

  const target = typeof document !== 'undefined' ? document.body : null;
  if (!target) return null;

  // Positioning frame: sized to the pane rect (or the whole viewport when no
  // host). It's pointer-events-none so backdrop clicks still reach the dim
  // layer; the panel re-enables pointer events. The frame is non-transformed so
  // the panel's framer-motion transform (scale/slide) stays conflict-free.
  const frameStyle: CSSProperties = rect
    ? { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { position: 'fixed', inset: 0 };

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
          className="fixed inset-0 z-[120] bg-gray-950/35 backdrop-blur-[1px]"
        />
      ) : null}
      {open ? (
        <motion.div
          key="rp-overlay-frame"
          initial={false}
          style={frameStyle}
          className={cn('pointer-events-none z-[121]', frameClass)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
            style={align === 'right' ? { width } : undefined}
            className={cn('flex flex-col overflow-hidden bg-white', panelClass, className)}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    target,
  );
}
