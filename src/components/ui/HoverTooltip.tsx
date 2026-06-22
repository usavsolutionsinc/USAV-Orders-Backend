'use client';

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/**
 * Lightweight hover/focus tooltip for plain meaning/help text.
 *
 * Renders the bubble in a body portal positioned from the trigger's rect, so it
 * is never clipped by an `overflow` container (e.g. a scrolling sidebar) and
 * appears instantly — unlike the native `title` attribute (slow, unstyled) and
 * unlike SiteTooltipProvider (which always shows a copy affordance).
 *
 * The bubble is measured once mounted, then clamped to the viewport (8px margin)
 * and flipped above/below as needed, so it NEVER renders off the page.
 */
export function HoverTooltip({
  label,
  children,
  className,
  focusable = true,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Set false when the trigger sits inside another focusable control (e.g. a row button). */
  focusable?: boolean;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  // Trigger rect captured on open; the bubble is positioned off-screen+hidden
  // first so we can measure it, then clamped into view in the layout effect.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      setAnchor(r);
      setPos(null);
    }
  }, []);
  const hide = useCallback(() => {
    setAnchor(null);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!anchor || !bubbleRef.current) return;
    const b = bubbleRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer above the trigger; flip below when there isn't room above.
    const roomAbove = anchor.top - MARGIN;
    const preferAbove = roomAbove >= b.height || roomAbove > vh - anchor.bottom;
    const rawTop = preferAbove ? anchor.top - b.height - MARGIN : anchor.bottom + MARGIN;
    const top = Math.min(Math.max(rawTop, MARGIN), Math.max(MARGIN, vh - b.height - MARGIN));

    // Center on the trigger, then clamp horizontally into the viewport.
    const rawLeft = anchor.left + anchor.width / 2 - b.width / 2;
    const left = Math.min(Math.max(rawLeft, MARGIN), Math.max(MARGIN, vw - b.width - MARGIN));

    setPos({ top, left });
  }, [anchor]);

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hide : undefined}
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
      {anchor && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={bubbleRef}
              role="tooltip"
              style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="pointer-events-none fixed z-tooltip max-w-[15rem] rounded-md bg-gray-900 px-2 py-1 text-caption font-semibold leading-snug text-white shadow-lg"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
