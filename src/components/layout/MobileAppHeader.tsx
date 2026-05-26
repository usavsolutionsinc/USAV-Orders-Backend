'use client';

import { usePathname } from 'next/navigation';
import { Menu } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import {
  mobileBoxedNavButtonClass,
  mobileBoxedNavCellClass,
} from '@/design-system/components/mobile/MobileBoxedNavButton';
import { QuickAccessButton } from '@/components/layout/QuickAccessButton';
import { useMobileAppNavigation } from '@/hooks/useMobileAppNavigation';
import { getMobileAppTitle } from '@/lib/mobile-context-navigation';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { cn } from '@/utils/_cn';

function MobileCockpitHubHeaderRow({ appTitle }: { appTitle: string }) {
  return (
    <div className="grid w-full min-h-[44px] grid-cols-[minmax(0,1fr)_44px] items-stretch bg-white">
      <div className="flex min-w-0 items-center px-3">
        <span className="truncate text-micro font-black uppercase tracking-[0.18em] text-gray-700">
          {appTitle}
        </span>
      </div>
      <div className={cn(mobileBoxedNavCellClass, 'min-w-[44px] justify-center')}>
        <QuickAccessButton placement="down" compact />
      </div>
    </div>
  );
}

function isMobileCockpitHubPath(pathname: string | null): boolean {
  return pathname === '/m/home' || pathname === '/m/home/';
}

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
  const hubHome = isMobileCockpitHubPath(pathname);

  return (
    <header
      className={cn(
        sidebarHeaderBandClass,
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      {hubHome ? (
        <MobileCockpitHubHeaderRow appTitle={appTitle} />
      ) : (
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
            <span className="truncate text-micro font-black uppercase tracking-[0.18em] text-gray-700">
              {appTitle}
            </span>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Mobile chrome for contextual-sidebar apps:
 * - `/m/home`: row 1 shows the current hub label (`Home`) and Quick Access on
 *   the right — no hamburger (full drawer is intentionally unavailable here).
 * - Other routes: row 1 is hamburger + current app title.
 * - Row 2 (when applicable): section pills via {@link HorizontalButtonSlider}.
 */
export function MobileAppHeader({ onOpenAppNav, className }: MobileAppHeaderProps) {
  const pathname = usePathname();
  const hubHome = isMobileCockpitHubPath(pathname);
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
      {/* Row 1 — mobile hub: current page label + quick access only (no drawer). */}
      {hubHome ? (
        <MobileCockpitHubHeaderRow appTitle={appTitle} />
      ) : (
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
            <span className="truncate text-micro font-black uppercase tracking-[0.18em] text-gray-700">
              {appTitle}
            </span>
          </div>
        </div>
      )}

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
