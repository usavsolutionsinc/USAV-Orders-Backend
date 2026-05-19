'use client';

import { usePathname } from 'next/navigation';
import { Menu } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { mobileBoxedNavButtonClass } from '@/design-system/components/mobile/MobileBoxedNavButton';
import { useMobileAppNavigation } from '@/hooks/useMobileAppNavigation';
import { getMobileAppTitle } from '@/lib/mobile-context-navigation';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
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
 * - Row 2: always-visible section pills (HorizontalButtonSlider, nav variant).
 *   Replaces the previous "Sections" dropdown + bottom-sheet picker so the
 *   current section and all peers are visible without an extra tap.
 */
export function MobileAppHeader({ onOpenAppNav, className }: MobileAppHeaderProps) {
  const {
    appTitle,
    contextRow,
    showContextRow,
    enterContextDetail,
  } = useMobileAppNavigation();

  const handleSectionSelect = (id: string) => {
    contextRow?.onSelect(id);
    enterContextDetail();
  };

  const sectionItems: HorizontalSliderItem[] | null = contextRow
    ? contextRow.options.map((opt) => ({ id: opt.id, label: opt.label }))
    : null;

  return (
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

      {/* Row 2 — inline pill row for the section switcher */}
      {showContextRow && contextRow && sectionItems ? (
        <div className="flex min-h-[44px] items-center border-t border-gray-300 bg-white px-2 py-1.5">
          <HorizontalButtonSlider
            className="w-full"
            aria-label={`${appTitle} sections`}
            variant="nav"
            size="md"
            items={sectionItems}
            value={contextRow.activeId}
            onChange={handleSectionSelect}
          />
        </div>
      ) : null}
    </header>
  );
}
