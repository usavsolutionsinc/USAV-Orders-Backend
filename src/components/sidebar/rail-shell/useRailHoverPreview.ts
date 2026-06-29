'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The shared on-hover preview primitive — the timer/open-state engine behind
 * every rail/card hover popover. Open on a debounced mouse-enter, close on a
 * debounced mouse-leave (the close delay lets the pointer travel from the row
 * onto the popover without it vanishing), and expose handlers the popover can
 * reuse so hovering the popover keeps it open.
 *
 * Pair with {@link RailPopover} for positioning. Used by both `RailRow` (the
 * recent-activity rail) and the tech Up-Next `OrderCard`, so the shipping
 * sidebar's hover preview behaves identically to the receiving/testing rail's.
 *
 * Usage:
 *   const preview = useRailHoverPreview({ enabled: Boolean(renderPopover) });
 *   <div ref={anchorRef} {...preview.hoverProps}>…</div>
 *   <AnimatePresence>
 *     {preview.isOpen && (
 *       <RailPopover anchorEl={anchorRef.current}
 *         onMouseEnter={preview.scheduleOpen} onMouseLeave={preview.scheduleClose}
 *         onDismiss={preview.dismiss}>…</RailPopover>
 *     )}
 *   </AnimatePresence>
 */
export function useRailHoverPreview(
  opts: { enabled?: boolean; openDelay?: number; closeDelay?: number } = {},
) {
  const { enabled = true, openDelay = 200, closeDelay = 150 } = opts;
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const scheduleOpen = useCallback(() => {
    if (!enabled) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (open || openTimer.current) return;
    openTimer.current = window.setTimeout(() => { openTimer.current = null; setOpen(true); }, openDelay);
  }, [enabled, open, openDelay]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setOpen(false); }, closeDelay);
  }, [closeDelay]);

  // Disabling mid-hover (e.g. entering edit mode) tears the preview down now.
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const dismiss = useCallback(() => setOpen(false), []);

  return {
    isOpen: open && enabled,
    hoverProps: { onMouseEnter: scheduleOpen, onMouseLeave: scheduleClose },
    scheduleOpen,
    scheduleClose,
    dismiss,
  };
}
