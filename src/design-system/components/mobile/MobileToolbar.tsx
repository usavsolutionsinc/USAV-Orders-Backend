'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '../../foundations/motion-framer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileToolbarProps {
  /** Page title — short, one line */
  title: string;
  /** Leading action (usually back arrow or menu) */
  leading?: ReactNode;
  /** Trailing actions (1–2 icon buttons) */
  trailing?: ReactNode;
  /** Optional subtitle / breadcrumb below title */
  subtitle?: string;
  /** Animate entrance */
  animate?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileToolbar — compact top app bar for mobile mode.
 *
 * Design rules:
 *   - Fixed height: 48px content + safe-area-inset-top
 *   - Title: 16px black weight, truncated
 *   - Max 2 trailing actions (overflow → `...` menu)
 *   - Frosted glass background when scrolled (handled by parent)
 *   - Leading slot: 44px touch target (back, menu, or close)
 */
export function MobileToolbar({
  title,
  leading,
  trailing,
  subtitle,
  animate = true,
  className = '',
}: MobileToolbarProps) {
  const Wrapper = animate ? motion.header : 'header';
  const motionProps = animate
    ? {
        initial: framerPresenceMobile.toolbar.initial,
        animate: framerPresenceMobile.toolbar.animate,
        transition: framerTransitionMobile.toolbarSlide,
      }
    : {};

  return (
    <Wrapper
      {...motionProps}
      className={`
        flex-shrink-0 bg-white/95 backdrop-blur-sm border-b border-gray-100
        pt-[max(0.5rem,env(safe-area-inset-top))]
        ${className}
      `.trim()}
    >
      <div className="flex items-center gap-2 px-3 h-12">
        {/* Leading action — 44px touch target */}
        {leading && (
          <div className="flex-shrink-0 h-11 w-11 flex items-center justify-center -ml-1">
            {leading}
          </div>
        )}

        {/* Title block */}
        <div className="flex-1 min-w-0">
          <h1 className="text-[15px] font-black text-gray-900 tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 truncate">
              {subtitle}
            </p>
          )}
        </div>

        {/* Trailing actions */}
        {trailing && (
          <div className="flex-shrink-0 flex items-center gap-1">
            {trailing}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
