'use client';

import { type ComponentPropsWithoutRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { AnchoredLayer, type AnchoredPlacement } from './AnchoredLayer';
import { framerPresence, framerTransition } from '../foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '../foundations/motion-framer-hooks';
import type { ZIndexToken } from '../tokens/z-index';

// ─── Popover ─────────────────────────────────────────────────────────────────
//
// The canonical anchored, *styled* popover panel. <AnchoredLayer> owns the hard
// part (portal, rect-tracking, dismissal) but no visual chrome; <Popover> adds
// the token-driven surface (rounded card, border, elevation) and the shared
// dropdown enter/exit motion — so callers stop re-rolling the same
// `rounded-xl border bg-surface-card shadow-lg` + AnimatePresence boilerplate.
//
// Motion comes from the SHARED presets (`framerPresence.dropdownPanel` +
// `framerTransition.dropdownOpen`), run through the reduced-motion-aware hooks.
//
// A11y: <AnchoredLayer> already owns Escape + outside-click dismissal. The
// trigger's `aria-haspopup`/`aria-expanded` stay caller-owned (as in
// ViewDropdown), since only the caller knows the trigger element. Pass a
// `role` ("menu"/"listbox"/"dialog") + `aria-label` straight through to the
// panel — extra props spread onto the styled panel.
//
// Usage:
//   const triggerRef = useRef<HTMLButtonElement>(null);
//   <button ref={triggerRef} aria-haspopup="menu" aria-expanded={open}
//           onClick={() => setOpen(o => !o)} />
//   <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef}
//            role="menu" aria-label="Row actions">
//     …content…
//   </Popover>

export interface PopoverProps
  extends Omit<
    ComponentPropsWithoutRef<typeof motion.div>,
    'children' | 'className' | 'initial' | 'animate' | 'exit' | 'transition'
  > {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Edge + alignment relative to the trigger. Default 'bottom-start'. */
  placement?: AnchoredPlacement;
  /** Gap in px between the trigger and the panel. Default 6. */
  gap?: number;
  /** Stacking band — use `panelOverlay` inside {@link RightPaneOverlay}. Default `dropdown`. */
  level?: ZIndexToken;
  /** Match the trigger width (always true for `*-stretch` placements). */
  matchWidth?: boolean;
  /** Inner padding. Default true. */
  padded?: boolean;
  /** Classes on the styled panel. */
  className?: string;
  children: ReactNode;
}

export function Popover({
  open,
  onClose,
  anchorRef,
  placement = 'bottom-start',
  gap = 6,
  level = 'dropdown',
  matchWidth = false,
  padded = true,
  className,
  children,
  ...rest
}: PopoverProps) {
  const presence = useMotionPresence(framerPresence.dropdownPanel);
  const transition = useMotionTransition(framerTransition.dropdownOpen);

  return (
    <AnchoredLayer
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement={placement}
      gap={gap}
      level={level}
      matchWidth={matchWidth}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            initial={presence.initial}
            animate={presence.animate}
            exit={presence.exit}
            transition={transition}
            className={cn(
              'min-w-[10rem] overflow-hidden rounded-xl border border-border-soft bg-surface-card text-text-default shadow-md',
              padded && 'p-2',
              className,
            )}
            {...rest}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </AnchoredLayer>
  );
}
