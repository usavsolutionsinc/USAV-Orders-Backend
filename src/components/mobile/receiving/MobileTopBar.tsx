'use client';

import { ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from '@/components/Icons';

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
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-gray-100 bg-white/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <button
        type="button"
        onClick={handleBack}
        aria-label="Back"
        className="-ml-1 flex h-11 w-11 items-center justify-center rounded-full text-gray-900 active:bg-gray-100"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <div className="min-w-0 flex-1">
        {subtitle ? (
          <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            {subtitle}
          </p>
        ) : null}
        <p className="truncate text-[15px] font-black tracking-tight text-gray-900">
          {title}
        </p>
      </div>
      {right ? <div className="flex items-center gap-1">{right}</div> : null}
    </header>
  );
}
