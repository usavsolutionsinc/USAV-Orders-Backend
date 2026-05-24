'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useUIModeOptional } from '../providers/UIModeProvider';
import {
  framerPresence,
  framerPresenceMobile,
  framerTransition,
  framerTransitionMobile,
  framerGesture,
} from '../foundations/motion-framer';

type CardTone = 'emerald' | 'red' | 'orange' | 'purple' | 'teal' | 'gray';

/**
 * Visual treatment when `isSelected` is true on desktop.
 * - `stripe` (default, legacy): left 3px accent + bottom border, in-line with the row stack.
 * - `framed`: full perimeter ring + rounded corners + soft lift. Card visually
 *   detaches from the row stack on selection.
 * - `linear`: Linear/Superhuman-style row. Left 3px accent on selection, subtle
 *   bg on hover, no ring or lift. Preserves vertical row rhythm; the selected
 *   card never visually jumps out of the stack. Used by the /tech Up Next list.
 */
type CardShellVariant = 'stripe' | 'framed' | 'linear';

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
  onClick?: () => void;
  className?: string;
}

const TONE_BORDER: Record<CardTone, { idle: string; active: string }> = {
  emerald: { idle: 'border-emerald-200', active: 'border-emerald-500' },
  red:     { idle: 'border-red-300',     active: 'border-red-500' },
  orange:  { idle: 'border-orange-200',  active: 'border-orange-500' },
  purple:  { idle: 'border-purple-200',  active: 'border-purple-500' },
  teal:    { idle: 'border-teal-200',    active: 'border-teal-500' },
  gray:    { idle: 'border-gray-200',    active: 'border-gray-400' },
};

const TONE_SELECTED: Record<CardTone, { bg: string; accent: string; ring: string }> = {
  emerald: { bg: 'bg-emerald-50/70',  accent: 'before:bg-emerald-500', ring: 'ring-emerald-300' },
  red:     { bg: 'bg-red-50/70',      accent: 'before:bg-red-500',     ring: 'ring-red-300' },
  orange:  { bg: 'bg-orange-50/70',   accent: 'before:bg-orange-500',  ring: 'ring-orange-300' },
  purple:  { bg: 'bg-purple-50/70',   accent: 'before:bg-purple-500',  ring: 'ring-purple-300' },
  teal:    { bg: 'bg-teal-50/70',     accent: 'before:bg-teal-500',    ring: 'ring-teal-300' },
  gray:    { bg: 'bg-gray-50',        accent: 'before:bg-gray-400',    ring: 'ring-gray-300' },
};

export function CardShell({
  children,
  isExpanded = false,
  isSelected = false,
  tone = 'emerald',
  isStock = false,
  variant = 'stripe',
  onClick,
  className = '',
}: CardShellProps) {
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
      : 'bg-white'
  } ${showActiveBorder ? border.active : `${border.idle} hover:${border.active}`}`;

  const desktopFramedClasses = isSelected
    // Selected: rounded ring, soft lift, tinted bg. Slight vertical margin so
    // the ring doesn't get clipped by neighbouring rows' separators.
    ? `relative cursor-pointer rounded-xl px-0 py-3 my-1 transition-all ${selected.bg} ring-2 ring-inset ${selected.ring} shadow-[0_1px_2px_rgba(16,185,129,0.10),0_4px_12px_-4px_rgba(16,185,129,0.15)]`
    // Idle: continues to act as a row in the stack — bottom separator + hover.
    : `relative cursor-pointer px-0 py-3 transition-colors bg-white border-b-2 ${border.idle} hover:${border.active}`;

  // `linear`: row stays in the stack at all times. Selected = left 3px accent
  // bar + tinted bg, no ring, no lift, no rounding. Hover = subtle bg only,
  // no border change so neighbours never shift. The trailing-action slot in
  // children should reserve its own width so opacity reveals don't jump.
  const desktopLinearClasses = isSelected
    ? `relative cursor-pointer px-3 py-2.5 transition-colors ${selected.bg} ${selected.accent} before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full`
    : `relative cursor-pointer px-3 py-2.5 transition-colors bg-white hover:bg-gray-50`;

  const desktopClasses =
    variant === 'framed'
      ? desktopFramedClasses
      : variant === 'linear'
      ? desktopLinearClasses
      : desktopStripeClasses;

  const mobileClasses = `rounded-2xl border mb-2 px-0 py-3 transition-colors relative ${
    isSelected
      ? `${selected.bg} ring-2 ring-inset ${selected.ring}`
      : 'bg-white'
  } ${showActiveBorder ? border.active : `${border.idle} active:${border.active}`}`;

  const presence = isMobile ? framerPresenceMobile.mobileCard : framerPresence.upNextRow;
  const transition = isMobile ? framerTransitionMobile.mobileCardMount : framerTransition.upNextRowMount;
  // Linear variant intentionally suppresses the lift/scale hover gesture so
  // rows don't jump and neighbours never shift. Hover state is bg-only.
  const hoverGesture = !isMobile && variant === 'linear' ? undefined : framerGesture.cardHover;

  return (
    <motion.div
      layout
      initial={presence.initial}
      animate={presence.animate}
      exit={presence.exit}
      whileHover={hoverGesture}
      whileTap={framerGesture.tapPress}
      transition={transition}
      onClick={onClick}
      className={`group ${isMobile ? mobileClasses : desktopClasses} ${className}`}
    >
      {children}
    </motion.div>
  );
}
