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

interface CardShellProps {
  children: ReactNode;
  isExpanded?: boolean;
  /**
   * The card is the right-pane workspace target. Stronger than `isExpanded`:
   * adds a tinted background, the active border, and (desktop only) a
   * left-edge accent stripe so the tech can find it at a glance.
   */
  isSelected?: boolean;
  tone?: CardTone;
  /** Use stock-tab styling (red border variant). */
  isStock?: boolean;
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
  // The `before:` pseudo paints a 3px left accent strip only while selected —
  // anchors the row visually without shifting layout.
  const desktopClasses = `border-b-2 px-0 py-3 transition-colors relative cursor-pointer ${
    isSelected
      ? `${selected.bg} ${selected.accent} before:absolute before:inset-y-0 before:left-0 before:w-[3px]`
      : 'bg-white'
  } ${showActiveBorder ? border.active : `${border.idle} hover:${border.active}`}`;

  const mobileClasses = `rounded-2xl border mb-2 px-0 py-3 transition-colors relative ${
    isSelected
      ? `${selected.bg} ring-2 ring-inset ${selected.ring}`
      : 'bg-white'
  } ${showActiveBorder ? border.active : `${border.idle} active:${border.active}`}`;

  const presence = isMobile ? framerPresenceMobile.mobileCard : framerPresence.upNextRow;
  const transition = isMobile ? framerTransitionMobile.mobileCardMount : framerTransition.upNextRowMount;

  return (
    <motion.div
      layout
      initial={presence.initial}
      animate={presence.animate}
      exit={presence.exit}
      whileHover={framerGesture.cardHover}
      whileTap={framerGesture.tapPress}
      transition={transition}
      onClick={onClick}
      className={`${isMobile ? mobileClasses : desktopClasses} ${className}`}
    >
      {children}
    </motion.div>
  );
}
