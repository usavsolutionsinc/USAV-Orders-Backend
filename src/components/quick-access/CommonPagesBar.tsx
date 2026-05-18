'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Barcode, Package, Search as SearchIcon, ShoppingCart } from '@/components/Icons';
import { dashboardShippedFocusSearchHref } from '@/utils/events';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';

interface CommonChip {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: (router: ReturnType<typeof useRouter>) => void;
}

const ICON_CLS = 'h-3.5 w-3.5';

/**
 * Fixed top-of-popover navigation chips. These are the highest-frequency
 * destinations across the app — searching shipped orders, jumping into a
 * receiving search, opening walk-in or FBA — surfaced as one-tap shortcuts.
 *
 * Distinct from the user's pinned pages: these are app-wide defaults that
 * everyone benefits from, not personal bookmarks.
 */
const CHIPS: CommonChip[] = [
  {
    id: 'shipped-search',
    label: 'Shipped',
    icon: <SearchIcon className={ICON_CLS} />,
    onClick: (router) => router.push(dashboardShippedFocusSearchHref()),
  },
  {
    id: 'receiving-search',
    label: 'Receiving',
    icon: <Barcode className={ICON_CLS} />,
    onClick: (router) => {
      router.push('/receiving');
      // Receiving's Mode1BulkScan listens for this and focuses its scan input.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
      }, 150);
    },
  },
  {
    id: 'walk-in',
    label: 'Walk-In',
    icon: <ShoppingCart className={ICON_CLS} />,
    onClick: (router) => router.push('/walk-in'),
  },
  {
    id: 'fba',
    label: 'Amazon FBA',
    icon: <Package className={ICON_CLS} />,
    onClick: (router) => router.push('/fba'),
  },
];

interface CommonPagesBarProps {
  onNavigate: () => void;
}

export function CommonPagesBar({ onNavigate }: CommonPagesBarProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef);

  return (
    <div className="shrink-0 border-b border-gray-100 bg-gray-50/60 px-3 py-2">
      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => {
              chip.onClick(router);
              onNavigate();
            }}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <span className="text-gray-500">{chip.icon}</span>
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CommonPagesBar;
