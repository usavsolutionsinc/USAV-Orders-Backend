'use client';

/**
 * Headless tooltip with a deliberate hover-in delay and below-trigger
 * positioning. Used by the sidebar's icon-only rail; could be reused
 * elsewhere where labels are hidden by design.
 *
 *   <Tooltip label="Receiving">
 *     <IconButton />
 *   </Tooltip>
 *
 * Behavior:
 *   • Shows after 400ms of continuous hover (configurable via `delayMs`).
 *   • Hides immediately on leave / blur / click anywhere.
 *   • Always positioned below the trigger so it doesn't fight a header above.
 *   • Keyboard focus reveals it instantly (a11y — no delay on tab nav).
 *   • Mouse-only — silent on touch, since the icon+label drawer view already
 *     surfaces labels on mobile.
 */

import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

interface TooltipProps {
  /** Tooltip text. Keep terse — "Receiving", not "View receiving lines". */
  label: string;
  /** The trigger. Must be a single element that accepts ref + event handlers. */
  children: ReactElement;
  /** Hover-in delay (ms). Default 400 — see frontend-design notes in the chat. */
  delayMs?: number;
  /** Hide the tooltip entirely (e.g. on touch breakpoints where labels are visible). */
  disabled?: boolean;
  /** Extra className for the tooltip bubble. */
  tooltipClassName?: string;
  /** Render the bubble inline (default) or hand back a render-prop. */
  contentSlot?: ReactNode;
}

interface Coords { x: number; y: number; w: number }

export function Tooltip({
  label,
  children,
  delayMs = 400,
  disabled = false,
  tooltipClassName = '',
  contentSlot,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const positionFrom = (el: HTMLElement): Coords => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom + 8, w: rect.width };
  };

  const show = useCallback((el: HTMLElement, immediate = false) => {
    clearTimer();
    if (disabled) return;
    if (immediate) {
      setCoords(positionFrom(el));
      setOpen(true);
      return;
    }
    timerRef.current = setTimeout(() => {
      setCoords(positionFrom(el));
      setOpen(true);
    }, delayMs);
  }, [delayMs, disabled, clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open, hide]);

  if (!isValidElement(children)) return children;

  const triggerProps = (children as ReactElement<Record<string, unknown>>).props;

  type AnyEvt = { currentTarget: HTMLElement };
  const handleMouseEnter = (e: AnyEvt) => {
    triggerRef.current = e.currentTarget;
    show(e.currentTarget);
    (triggerProps.onMouseEnter as ((ev: AnyEvt) => void) | undefined)?.(e);
  };
  const handleMouseLeave = (e: AnyEvt) => {
    hide();
    (triggerProps.onMouseLeave as ((ev: AnyEvt) => void) | undefined)?.(e);
  };
  const handleFocus = (e: AnyEvt) => {
    triggerRef.current = e.currentTarget;
    show(e.currentTarget, true);
    (triggerProps.onFocus as ((ev: AnyEvt) => void) | undefined)?.(e);
  };
  const handleBlur = (e: AnyEvt) => {
    hide();
    (triggerProps.onBlur as ((ev: AnyEvt) => void) | undefined)?.(e);
  };
  const handleClick = (e: AnyEvt) => {
    hide();
    (triggerProps.onClick as ((ev: AnyEvt) => void) | undefined)?.(e);
  };

  const augmented = cloneElement(children, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onClick: handleClick,
  } as Record<string, unknown>);

  return (
    <>
      {augmented}
      {open && coords && !disabled && (
        <div
          role="tooltip"
          aria-hidden={false}
          style={{ position: 'fixed', left: coords.x, top: coords.y, transform: 'translateX(-50%)', zIndex: 200 }}
          className={`pointer-events-none select-none rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow-lg shadow-gray-900/30 ${tooltipClassName}`}
        >
          <span
            aria-hidden
            style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%) rotate(45deg)' }}
            className="h-2 w-2 bg-gray-900"
          />
          {contentSlot ?? label}
        </div>
      )}
    </>
  );
}
