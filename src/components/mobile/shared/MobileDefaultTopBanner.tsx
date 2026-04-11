'use client';

import { ChevronLeft } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';

interface MobileDefaultTopBannerProps {
  title: string;
  onBack: () => void;
}

/**
 * Default mobile top banner for pages that don't provide their own.
 * Matches the grid layout used by tech/packer/sku-stock top banners.
 *
 * [← back] [title] [spacer]
 */
export function MobileDefaultTopBanner({ title, onBack }: MobileDefaultTopBannerProps) {
  const headerBandClass = `${sidebarHeaderBandClass} pt-[env(safe-area-inset-top)]`;

  return (
    <div className={headerBandClass}>
      <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)_40px] items-stretch divide-x divide-gray-400">
        <div className="flex min-h-[44px] items-stretch bg-white">
          <button
            type="button"
            onClick={onBack}
            aria-label="Open app navigation"
            className="flex h-full w-full items-center justify-center bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-[44px] items-center justify-center bg-white px-3">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-700">
            {title}
          </span>
        </div>
        <div className="flex min-h-[44px] items-stretch bg-white" aria-hidden />
      </div>
    </div>
  );
}
