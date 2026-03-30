'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { framerTransitionMobile } from '../../foundations/motion-framer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileNavItem {
  /** Unique key for this tab */
  id: string;
  /** Icon element — rendered at mobileIconSize.nav (h-6 w-6) */
  icon: ReactNode;
  /** Short label (1 word preferred) */
  label: string;
  /** Accessible description for screen readers */
  ariaLabel?: string;
}

export interface MobileNavBarProps {
  items: MobileNavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileNavBar — fixed bottom navigation for mobile mode.
 *
 * Design rules:
 *   - 3–5 items max (enforced by the `bottomNav.maxItems` token)
 *   - Icons at 24px, labels at 9px uppercase
 *   - Active tab gets accent color + dot indicator
 *   - Safe-area-inset-bottom padding for notch devices
 *   - No Framer layout animations on the bar itself (stays fixed)
 *   - Active indicator uses `layoutId` for smooth tab crossfade
 *
 * Accessibility:
 *   - `role="navigation"` + `aria-label`
 *   - Each item is a button with `aria-current` when active
 *   - Labels always visible (not icon-only) per iOS HIG
 */
export function MobileNavBar({
  items,
  activeId,
  onNavigate,
  className = '',
}: MobileNavBarProps) {
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      className={`
        flex-shrink-0 bg-white border-t border-gray-200
        pb-[max(0.5rem,env(safe-area-inset-bottom))]
        ${className}
      `.trim()}
    >
      <div className="flex items-stretch justify-around px-2 pt-1.5">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.ariaLabel ?? item.label}
              className={`
                relative flex flex-1 flex-col items-center gap-0.5 py-1.5 rounded-xl
                transition-colors duration-100
                ${isActive
                  ? 'text-blue-600'
                  : 'text-gray-400 active:text-gray-600'
                }
              `.trim()}
            >
              {/* Active indicator dot */}
              {isActive && (
                <motion.span
                  layoutId="mobile-nav-indicator"
                  transition={framerTransitionMobile.navIconSwap}
                  className="absolute -top-0.5 h-[3px] w-5 rounded-full bg-blue-600"
                />
              )}

              {/* Icon — 24px */}
              <span className="h-6 w-6 flex items-center justify-center">
                {item.icon}
              </span>

              {/* Label — always visible */}
              <span className={`
                text-[9px] font-black uppercase tracking-[0.12em] leading-none
                ${isActive ? 'text-blue-600' : 'text-gray-400'}
              `.trim()}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
