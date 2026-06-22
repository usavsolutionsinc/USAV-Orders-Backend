'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';

/**
 * Generic hover-preview popover positioning wrapper. Handles portal, viewport
 * flipping, resize/scroll reflow, and Escape-to-dismiss. Content is supplied
 * by the caller via children.
 */
export function RailPopover({
  anchorEl, onMouseEnter, onMouseLeave, onDismiss, children,
}: {
  anchorEl: HTMLElement | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const POPOVER_WIDTH = 320;
  const POPOVER_FALLBACK_HEIGHT = 440;
  const VIEWPORT_PADDING = 8;
  const GAP = 10;
  const [coords, setCoords] = useState<{ left: number; top: number; flipped: boolean } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const measurePosition = useCallback(() => {
    if (!anchorEl) return null;
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const flipped = vw - rect.right < POPOVER_WIDTH + GAP + 12;
    const left = flipped
      ? Math.max(VIEWPORT_PADDING, rect.left - POPOVER_WIDTH - GAP)
      : Math.min(vw - POPOVER_WIDTH - VIEWPORT_PADDING, rect.right + GAP);
    const popH = popoverRef.current?.getBoundingClientRect().height ?? POPOVER_FALLBACK_HEIGHT;
    const maxTop = Math.max(VIEWPORT_PADDING, vh - popH - VIEWPORT_PADDING);
    const top = Math.max(VIEWPORT_PADDING, Math.min(rect.top, maxTop));
    return { left, top, flipped };
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const apply = () => { const next = measurePosition(); if (next) setCoords(next); };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => { window.removeEventListener('resize', apply); window.removeEventListener('scroll', apply, true); };
  }, [anchorEl, measurePosition]);

  const previewVisible = coords !== null;
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!anchorEl || !previewVisible || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const next = measurePosition(); if (next) setCoords(next); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchorEl, previewVisible, measurePosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (typeof document === 'undefined' || !coords) return null;

  return createPortal(
    <motion.div
      ref={popoverRef}
      role="dialog"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      initial={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.6 }}
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH, zIndex: zLayer.panelPopover }}
      className="rounded-xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
