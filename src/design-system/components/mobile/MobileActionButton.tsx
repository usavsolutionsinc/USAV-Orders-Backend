'use client';

import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '../../foundations/motion-framer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileActionButtonProps {
  /** Icon element — rendered at 24px */
  icon: ReactNode;
  /** Optional short label next to icon (extended FAB) */
  label?: string;
  /** Click handler */
  onClick: () => void;
  /** Accessible label (required if no visible label) */
  ariaLabel: string;
  /** Tone: primary (blue), danger (red), success (green) */
  tone?: 'primary' | 'danger' | 'success';
  /** Control visibility with AnimatePresence */
  visible?: boolean;
  /** Override position classes. Default: bottom-right above nav */
  className?: string;
}

// ─── Tone mapping ────────────────────────────────────────────────────────────

const toneClasses: Record<NonNullable<MobileActionButtonProps['tone']>, string> = {
  primary: 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 active:bg-blue-700',
  danger: 'bg-red-600 text-white shadow-lg shadow-red-600/25 active:bg-red-700',
  success: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 active:bg-emerald-700',
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileActionButton (FAB) — floating primary action for mobile mode.
 *
 * Design rules:
 *   - 56px diameter (meets `touchTarget.large`)
 *   - Positioned bottom-right, above MobileNavBar by default
 *   - Spring entrance/exit via `framerPresenceMobile.fab`
 *   - Extends to pill shape when `label` is provided (extended FAB)
 *   - Active scale-down on press for tactile feedback
 *   - Respects `prefers-reduced-motion` via Framer's built-in support
 *
 * Positioning:
 *   Default is `fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4`
 *   which places it above the 56px bottom nav + safe area.
 *   Override with `className` if needed.
 */
export function MobileActionButton({
  icon,
  label,
  onClick,
  ariaLabel,
  tone = 'primary',
  visible = true,
  className,
}: MobileActionButtonProps) {
  const positionClass = className ?? 'fixed bottom-[calc(72px+env(safe-area-inset-bottom,0px))] right-4 z-50';

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          initial={framerPresenceMobile.fab.initial}
          animate={framerPresenceMobile.fab.animate}
          exit={framerPresenceMobile.fab.exit}
          transition={framerTransitionMobile.fabMount}
          whileTap={{ scale: 0.92 }}
          className={`
            flex items-center justify-center gap-2
            rounded-full
            ${label ? 'h-14 px-5' : 'h-14 w-14'}
            ${toneClasses[tone]}
            ${positionClass}
          `.trim()}
        >
          <span className="h-6 w-6 flex items-center justify-center flex-shrink-0">
            {icon}
          </span>
          {label && (
            <span className="text-[11px] font-black uppercase tracking-wider whitespace-nowrap pr-1">
              {label}
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
