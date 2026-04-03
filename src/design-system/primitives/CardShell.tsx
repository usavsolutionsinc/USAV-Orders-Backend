'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useUIModeOptional } from '../providers/UIModeProvider';
import {
  framerPresence,
  framerPresenceMobile,
  framerTransition,
  framerTransitionMobile,
} from '../foundations/motion-framer';

type CardTone = 'emerald' | 'red' | 'orange' | 'purple' | 'teal' | 'gray';

interface CardShellProps {
  children: ReactNode;
  isExpanded?: boolean;
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

export function CardShell({
  children,
  isExpanded = false,
  tone = 'emerald',
  isStock = false,
  onClick,
  className = '',
}: CardShellProps) {
  const { isMobile } = useUIModeOptional();
  const activeTone = isStock ? 'red' : tone;
  const border = TONE_BORDER[activeTone];

  // Desktop: flat row separator. Mobile: rounded card.
  const desktopClasses = `border-b-2 px-0 py-3 transition-colors relative cursor-pointer bg-white ${
    isExpanded ? border.active : `${border.idle} hover:${border.active}`
  }`;

  const mobileClasses = `rounded-2xl border mb-2 px-0 py-3 transition-colors relative bg-white ${
    isExpanded ? border.active : `${border.idle} active:${border.active}`
  }`;

  const presence = isMobile ? framerPresenceMobile.mobileCard : framerPresence.upNextRow;
  const transition = isMobile ? framerTransitionMobile.mobileCardMount : framerTransition.upNextRowMount;

  return (
    <motion.div
      layout
      initial={presence.initial}
      animate={presence.animate}
      exit={presence.exit}
      whileHover={{ scale: 1.002, x: 2 }}
      whileTap={{ scale: 0.995 }}
      transition={transition}
      onClick={onClick}
      className={`${isMobile ? mobileClasses : desktopClasses} ${className}`}
    >
      {children}
    </motion.div>
  );
}
