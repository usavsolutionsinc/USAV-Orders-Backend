'use client';

import { ChevronLeft, ChevronRight } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/** Matches mobile tech header grid cells: square, no rounding, light hover. */
export const mobileBoxedNavButtonClass =
  'flex h-full w-full min-h-[44px] min-w-[40px] items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:opacity-35 disabled:pointer-events-none';

/** Wrapper width for toolbar leading/trailing slots (aligns with tech `grid-cols-[40px_…_40px]`). */
export const mobileBoxedNavCellClass =
  'flex min-h-[44px] min-w-[40px] shrink-0 items-stretch bg-white';

export interface MobileBoxedNavChevronProps {
  direction: 'left' | 'right';
  onClick?: () => void;
  disabled?: boolean;
  /** Defaults from direction */
  'aria-label'?: string;
  className?: string;
}

/**
 * Boxed chevron control for mobile top bars — same visual language as `MobileTechTopBanner` back/forward cells.
 */
export function MobileBoxedNavChevron({
  direction,
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: MobileBoxedNavChevronProps) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  const defaultLabel =
    direction === 'left' ? 'Go back' : 'Go forward';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? defaultLabel}
      className={cn(mobileBoxedNavButtonClass, className)}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/** Opens the same mobile nav drawer as the dashboard hamburger (`ResponsiveLayout`). */
export function dispatchOpenMobileAppDrawer(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
}
