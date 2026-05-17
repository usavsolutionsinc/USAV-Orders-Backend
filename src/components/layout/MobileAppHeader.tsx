'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronLeft, Menu } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { mobileBoxedNavButtonClass } from '@/design-system/components/mobile/MobileBoxedNavButton';
import { useMobileAppNavigation } from '@/hooks/useMobileAppNavigation';
import { getMobileAppTitle } from '@/lib/mobile-context-navigation';
import { MobileNavPickerSheet } from '@/components/layout/MobileNavPickerSheet';
import { cn } from '@/utils/_cn';

export interface MobileAppHeaderProps {
  onOpenAppNav: () => void;
  className?: string;
}

/** Row 1 only — used as Suspense fallback while search-param context resolves. */
export function MobileAppHeaderFallback({
  onOpenAppNav,
  className,
}: MobileAppHeaderProps) {
  const pathname = usePathname();
  const appTitle = getMobileAppTitle(pathname);

  return (
    <header
      className={cn(
        sidebarHeaderBandClass,
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <div className="grid w-full min-h-[44px] grid-cols-[44px_minmax(0,1fr)] items-stretch">
        <button
          type="button"
          onClick={onOpenAppNav}
          aria-label="Open app navigation"
          className={mobileBoxedNavButtonClass}
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 items-center bg-white px-3">
          <span className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-gray-700">
            {appTitle}
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Mobile chrome for contextual-sidebar apps:
 * - Row 1: hamburger + current app title
 * - Row 2 (browse): in-app section picker — opens section sheet
 * - Row 2 (detail): back to section picker + active subsection label
 */
export function MobileAppHeader({ onOpenAppNav, className }: MobileAppHeaderProps) {
  const {
    appTitle,
    contextRow,
    showContextRow,
    contextPhase,
    enterContextDetail,
    backToContextBrowse,
  } = useMobileAppNavigation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleSectionSelect = (id: string) => {
    contextRow?.onSelect(id);
    enterContextDetail();
    setPickerOpen(false);
  };

  const showBrowseRow = showContextRow && contextPhase === 'browse';
  const showDetailRow = showContextRow && contextPhase === 'detail' && contextRow;

  return (
    <>
      <header
        className={cn(
          sidebarHeaderBandClass,
          'pt-[env(safe-area-inset-top)]',
          className,
        )}
      >
        {/* Row 1 — fixed 44px nav column (w-full on the button collapses flex siblings) */}
        <div className="grid w-full min-h-[44px] grid-cols-[44px_minmax(0,1fr)] items-stretch">
          <button
            type="button"
            onClick={onOpenAppNav}
            aria-label="Open app navigation"
            className={mobileBoxedNavButtonClass}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 items-center bg-white px-3">
            <span className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-gray-700">
              {appTitle}
            </span>
          </div>
        </div>

        {/* Row 2 (browse) — section menu before drilling into a subsection */}
        {showBrowseRow && contextRow ? (
          <div className="grid w-full min-h-[44px] grid-cols-1 items-stretch border-t border-gray-300">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-h-[44px] min-w-0 items-center justify-between gap-2 bg-white px-4 text-left active:bg-gray-50"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
            >
              <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
                Sections
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            </button>
          </div>
        ) : null}

        {/* Row 2 (detail) — back to section picker + current subsection */}
        {showDetailRow ? (
          <div className="grid w-full min-h-[44px] grid-cols-[44px_minmax(0,1fr)] items-stretch border-t border-gray-300">
            <button
              type="button"
              onClick={backToContextBrowse}
              aria-label="Back to sections"
              className={mobileBoxedNavButtonClass}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-h-[44px] min-w-0 items-center justify-between gap-2 bg-white px-3 text-left active:bg-gray-50"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
            >
              <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
                {contextRow.activeLabel}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            </button>
          </div>
        ) : null}
      </header>

      {contextRow ? (
        <MobileNavPickerSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={`${appTitle} sections`}
          options={contextRow.options}
          activeId={contextRow.activeId}
          onSelect={handleSectionSelect}
        />
      ) : null}
    </>
  );
}
