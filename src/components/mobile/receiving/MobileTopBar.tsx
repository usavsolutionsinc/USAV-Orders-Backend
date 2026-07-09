'use client';

import { ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';

interface MobileTopBarProps {
  title: string;
  subtitle?: string;
  /** Optional URL to navigate back to. If omitted, `router.back()` is used. */
  backHref?: string;
  /** Slot at the right edge — search button, kebab, network chip, etc. */
  right?: ReactNode;
}

/**
 * Sticky top bar for every mobile receiving detail screen. Back chevron is
 * always top-left, 44x44 hit area, with a real `aria-label` so screen readers
 * announce it. The title block truncates so vendor names with long suffixes
 * don't push the right slot off-screen.
 */
export function MobileTopBar({ title, subtitle, backHref, right }: MobileTopBarProps) {
  const router = useRouter();

  const handleBack = useCallback(() => {
    if (backHref) router.push(backHref);
    else router.back();
  }, [backHref, router]);

  return (
    <header className="sticky top-0 z-header flex h-14 items-center gap-2 border-b border-border-hairline bg-surface-card/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-surface-card/80">
      <IconButton
        onClick={handleBack}
        ariaLabel="Back"
        icon={<ChevronLeft className="h-6 w-6 text-text-default" />}
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-full active:bg-surface-sunken"
      />
      <div className="min-w-0 flex-1">
        {subtitle ? (
          <p className="truncate text-micro font-black uppercase tracking-[0.18em] text-text-soft">
            {subtitle}
          </p>
        ) : null}
        <p className="truncate text-base font-black tracking-tight text-text-default">
          {title}
        </p>
      </div>
      {right ? <div className="flex items-center gap-1">{right}</div> : null}
    </header>
  );
}
