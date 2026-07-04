'use client';

import { forwardRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useUIModeOptional } from '../providers/UIModeProvider';
import {
  framerPresence,
  framerPresenceMobile,
  framerTransition,
  framerTransitionMobile,
  framerGesture,
} from '../foundations/motion-framer';
import { staggerRevealItem } from './StaggerReveal';

type CardTone = 'emerald' | 'red' | 'orange' | 'purple' | 'teal' | 'gray';

/**
 * Visual treatment when `isSelected` is true on desktop.
 * - `stripe` (default, legacy): left 3px accent + bottom border, in-line with the row stack.
 * - `framed`: full perimeter ring + rounded corners + soft lift. Card visually
 *   detaches from the row stack on selection.
 * - `linear`: Linear/Superhuman-style row. Left 3px accent on selection, subtle
 *   bg on hover, no ring or lift. Preserves vertical row rhythm; the selected
 *   card never visually jumps out of the stack.
 * - `rail`: recent-activity rail row. Flat row, `bg-blue-50 ring` selection (the
 *   house selection treatment — always blue, ignores `tone`), `hover:bg-surface-hover`,
 *   no border/lift. Matches `RailRow` so the /tech Up Next list reads as the same
 *   primitive as the receiving/testing recent rail.
 */
type CardShellVariant = 'stripe' | 'framed' | 'linear' | 'rail';

interface CardShellProps {
  children: ReactNode;
  isExpanded?: boolean;
  /**
   * The card is the right-pane workspace target. Stronger than `isExpanded`:
   * adds a tinted background and (in `stripe` variant) a left-edge accent
   * stripe, or (in `framed` variant) a full perimeter ring + lift.
   */
  isSelected?: boolean;
  tone?: CardTone;
  /** Use stock-tab styling (red border variant). */
  isStock?: boolean;
  /** Desktop selected-state treatment. Defaults to `stripe`. */
  variant?: CardShellVariant;
  /**
   * Mount entrance.
   * - `self` (default): the card runs its own fade/slide on mount.
   * - `stagger`: the card inherits a parent stagger-reveal container's timeline
   *   (see {@link staggerRevealItem}) instead, so a list of cards cascades in
   *   together. Standalone (no orchestrating parent) it simply renders in place.
   */
  entrance?: 'self' | 'stagger';
  onClick?: () => void;
  /** Hover passthrough — wired by callers that anchor a hover preview to the card. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
}

const TONE_BORDER: Record<CardTone, { idle: string; active: string }> = {
  emerald: { idle: 'border-emerald-200', active: 'border-emerald-500' },
  red:     { idle: 'border-red-300',     active: 'border-red-500' },
  orange:  { idle: 'border-orange-200',  active: 'border-orange-500' },
  purple:  { idle: 'border-purple-200',  active: 'border-purple-500' },
  teal:    { idle: 'border-teal-200',    active: 'border-teal-500' },
  gray:    { idle: 'border-border-soft',    active: 'border-border-emphasis' },
};

const TONE_SELECTED: Record<CardTone, { bg: string; accent: string; ring: string }> = {
  emerald: { bg: 'bg-emerald-50/70',  accent: 'before:bg-emerald-500', ring: 'ring-emerald-300' },
  red:     { bg: 'bg-red-50/70',      accent: 'before:bg-red-500',     ring: 'ring-red-300' },
  orange:  { bg: 'bg-orange-50/70',   accent: 'before:bg-orange-500',  ring: 'ring-orange-300' },
  purple:  { bg: 'bg-purple-50/70',   accent: 'before:bg-purple-500',  ring: 'ring-purple-300' },
  teal:    { bg: 'bg-teal-50/70',     accent: 'before:bg-teal-500',    ring: 'ring-teal-300' },
  gray:    { bg: 'bg-surface-canvas',        accent: 'before:bg-border-emphasis',    ring: 'ring-border-default' },
};

export const CardShell = forwardRef<HTMLDivElement, CardShellProps>(function CardShell({
  children,
  isExpanded = false,
  isSelected = false,
  tone = 'emerald',
  isStock = false,
  variant = 'stripe',
  entrance = 'self',
  onClick,
  onMouseEnter,
  onMouseLeave,
  className = '',
}, ref) {
  const { isMobile } = useUIModeOptional();
  const activeTone = isStock ? 'red' : tone;
  const border = TONE_BORDER[activeTone];
  const selected = TONE_SELECTED[activeTone];
  // When selected, lock the border to the active color and add the
  // accent/tint. `isExpanded` keeps its border-only behavior so the two
  // states stack: a selected card that's also expanded still reads as "open".
  const showActiveBorder = isExpanded || isSelected;

  // Desktop: flat row separator. Mobile: rounded card.
  // `stripe`: left 3px accent strip on selected, in-stack row.
  // `framed`: full perimeter ring + rounded corners on selected, lifted out
  //   of the row stack. Idle rows still get the bottom-border separator so
  //   the unselected list reads as a continuous stack.
  const desktopStripeClasses = `border-b-2 px-0 py-3 transition-colors relative cursor-pointer ${
    isSelected
      ? `${selected.bg} ${selected.accent} before:absolute before:inset-y-0 before:left-0 before:w-[3px]`
      : 'bg-surface-card'
  } ${showActiveBorder ? border.active : `${border.idle} hover:${border.active}`}`;

  const desktopFramedClasses = isSelected
    // Selected: rounded ring, soft lift, tinted bg. Slight vertical margin so
    // the ring doesn't get clipped by neighbouring rows' separators.
    ? `relative cursor-pointer rounded-xl px-0 py-3 my-1 transition-all ${selected.bg} ring-2 ring-inset ${selected.ring} shadow-[0_1px_2px_rgba(16,185,129,0.10),0_4px_12px_-4px_rgba(16,185,129,0.15)]`
    // Idle: continues to act as a row in the stack — bottom separator + hover.
    : `relative cursor-pointer px-0 py-3 transition-colors bg-surface-card border-b-2 ${border.idle} hover:${border.active}`;

  // `linear`: row stays in the stack at all times. Selected = left 3px accent
  // bar + tinted bg, no ring, no lift, no rounding. Hover = subtle bg only,
  // no border change so neighbours never shift. The trailing-action slot in
  // children should reserve its own width so opacity reveals don't jump.
  const desktopLinearClasses = isSelected
    ? `relative cursor-pointer px-3 py-2.5 transition-colors ${selected.bg} ${selected.accent} before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full`
    : `relative cursor-pointer px-3 py-2.5 transition-colors bg-surface-card hover:bg-surface-hover`;

  // `rail`: flat recent-activity rail row. Always-blue house selection
  // (`bg-blue-50 ring-1 ring-inset ring-blue-400`), tone is ignored. Tighter
  // padding than `linear` to match `RailRow`; hover is bg-only so neighbours
  // never shift.
  const desktopRailClasses = `relative cursor-pointer rounded-md px-2 py-1.5 transition-colors ${
    isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'bg-surface-card hover:bg-surface-hover'
  }`;

  const desktopClasses =
    variant === 'framed'
      ? desktopFramedClasses
      : variant === 'linear'
      ? desktopLinearClasses
      : variant === 'rail'
      ? desktopRailClasses
      : desktopStripeClasses;

  const mobileClasses = `rounded-2xl border mb-2 px-0 py-3 transition-colors relative ${
    isSelected
      ? `${selected.bg} ring-2 ring-inset ${selected.ring}`
      : 'bg-surface-card'
  } ${showActiveBorder ? border.active : `${border.idle} active:${border.active}`}`;

  const presence = isMobile ? framerPresenceMobile.mobileCard : framerPresence.upNextRow;
  const transition = isMobile ? framerTransitionMobile.mobileCardMount : framerTransition.upNextRowMount;
  // Linear + rail variants intentionally suppress the lift/scale hover gesture
  // so rows don't jump and neighbours never shift. Hover state is bg-only.
  const flatRow = variant === 'linear' || variant === 'rail';
  const hoverGesture = !isMobile && flatRow ? undefined : framerGesture.cardHover;

  // `stagger`: omit own initial/animate/transition so the card inherits the
  // parent stagger-reveal container's hidden→show timeline (the scan-bar spring
  // lives in the variant). `self`: the card's original standalone entrance.
  const entranceProps =
    entrance === 'stagger'
      ? { variants: staggerRevealItem, exit: 'exit' as const }
      : { initial: presence.initial, animate: presence.animate, exit: presence.exit, transition };

  return (
    <motion.div
      ref={ref}
      layout
      {...entranceProps}
      whileHover={hoverGesture}
      whileTap={framerGesture.tapPress}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group ${isMobile ? mobileClasses : desktopClasses} ${className}`}
    >
      {children}
    </motion.div>
  );
});
