'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ShippedFormData } from '@/components/shipped';
import { ShippedIntakeForm } from '@/components/shipped/ShippedIntakeForm';
import { Plus } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { DashboardShippedSearchHandoffCard } from '@/components/dashboard/DashboardShippedSearchHandoffCard';
import { OutboundLabelsSearchHandoffCard } from '@/components/dashboard/OutboundLabelsSearchHandoffCard';
import { OrdersSyncPopover } from '@/components/unshipped/OrdersSyncPopover';
import { FirstScanOnboardingCard } from '@/components/dashboard/FirstScanOnboardingCard';
import { GettingStartedChecklist } from '@/components/dashboard/GettingStartedChecklist';
import { ThroughputRoiCard } from '@/components/dashboard/ThroughputRoiCard';
import { motion } from 'framer-motion';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface UnshippedSidebarProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  embedded?: boolean;
  hideSectionHeader?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onOpenShippedMatches?: (searchQuery: string) => void;
  onOpenLabelsMatches?: (searchQuery: string) => void;
}

interface SearchHistory {
  query: string;
  timestamp: Date;
  resultCount?: number;
}

export default function UnshippedSidebar(props: UnshippedSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    showIntakeForm = false,
    onCloseForm,
    onFormSubmit,
    filterControl,
    embedded = false,
    hideSectionHeader = false,
    searchValue = '',
    onSearchChange,
    onOpenShippedMatches,
    onOpenLabelsMatches,
  } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dashboard_search_history');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setSearchHistory(
        parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }))
      );
    } catch (_error) {
      setSearchHistory([]);
    }
  }, []);

  const saveSearchHistory = (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const newHistory = [
      { query: trimmedQuery, timestamp: new Date() },
      ...searchHistory.filter((item) => item.query !== trimmedQuery).slice(0, 4),
    ];
    setSearchHistory(newHistory);
    localStorage.setItem('dashboard_search_history', JSON.stringify(newHistory));
  };

  const handleSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      saveSearchHistory(trimmedQuery);
    }
    await onSearchChange?.(trimmedQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSearchChange]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleSearch(value);
    }, 400);
  }, [handleSearch]);

  const clearSearchHistory = () => {
    setSearchHistory([]);
    setShowAllSearchHistory(false);
    localStorage.removeItem('dashboard_search_history');
  };

  const handleOpenIntakeForm = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('new', 'true');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
  };

  // ── Stage filter (fulfillment queue only) ─────────────────────────────────
  const stageParam = String(searchParams.get('stage') || 'all').toLowerCase();

  useEffect(() => {
    if (stageParam !== 'awaiting') return;
    const params = new URLSearchParams();
    const q = searchValue.trim() || searchParams.get('search')?.trim();
    if (q) params.set('q', q);
    const qs = params.toString();
    router.replace(qs ? `/outbound?${qs}` : '/outbound', { scroll: false });
  }, [stageParam, searchValue, searchParams, router]);

  // Stage + staff filtering moved OFF the sidebar: the swim-lane board sorts orders
  // into PENDING / TESTED / BLOCKED lanes (replacing the stage filter), and the
  // board header hosts its own staff filter (BoardStaffFilter). The `?stage=awaiting`
  // legacy redirect above is kept. So no sidebar Filters button here anymore.

  if (showIntakeForm) {
    return (
      <ShippedIntakeForm
        onClose={onCloseForm || (() => {})}
        onSubmit={onFormSubmit || (() => {})}
      />
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
    },
  };

  const visibleSearchHistory = showAllSearchHistory ? searchHistory : searchHistory.slice(0, 3);

  const content = (
    <SidebarShell
      as={motion.div}
      containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
      headerAbove={
        <>
          {filterControl ? (
            <motion.div variants={itemVariants} className="relative z-20">
              {filterControl}
            </motion.div>
          ) : null}
          {!hideSectionHeader ? (
            <motion.header variants={itemVariants} className={`${SIDEBAR_GUTTER} ${filterControl ? 'pt-2' : 'pt-6'}`}>
              <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-text-default">
                Unshipped
              </h2>
              <p className="text-eyebrow font-bold text-text-accent uppercase tracking-widest mt-1">
                Fulfillment Queue
              </p>
            </motion.header>
          ) : null}
        </>
      }
      search={{
        value: searchQuery,
        onChange: handleInputChange,
        onSearch: handleSearch,
        onClear: () => { setSearchQuery(''); handleSearch(''); },
        inputRef: searchInputRef,
        placeholder: 'Search orders, serials...',
        variant: 'blue',
        rightElement: (
          <HoverTooltip label="New Order Entry" asChild>
            <button
              type="button"
              onClick={handleOpenIntakeForm}
              className="ds-raw-button rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-surface-strong"
              aria-label="Open new order entry form"
            >
              <Plus className="h-5 w-5" />
            </button>
          </HoverTooltip>
        ),
      }}
      // The PENDING / TESTED / BLOCKED status legend was removed: the Unshipped
      // swim-lane board now sorts orders into those exact lanes, so a sidebar
      // click-to-filter legend on the same three states was redundant.
      bodyClassName="flex flex-col no-scrollbar pb-6"
    >
      <OrdersSyncPopover
        onRefresh={() => {
          window.dispatchEvent(new CustomEvent('dashboard-refresh'));
          window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        }}
      />
      <div className="space-y-3 border-t border-border-hairline pt-3">
        <FirstScanOnboardingCard variant="sidebar" />
        <GettingStartedChecklist variant="sidebar" />
        <ThroughputRoiCard variant="sidebar" />
      </div>
      <motion.div variants={itemVariants} initial="hidden" animate="visible" className="space-y-4">
        <RecentSearchesList
          items={visibleSearchHistory}
          totalCount={searchHistory.length}
          expanded={showAllSearchHistory}
          onToggleExpanded={() => setShowAllSearchHistory((current) => !current)}
          onClear={clearSearchHistory}
          onSelect={(query) => {
            setSearchQuery(query);
            handleSearch(query);
          }}
        />
        <DashboardShippedSearchHandoffCard
          searchQuery={searchQuery}
          onOpenShippedMatches={onOpenShippedMatches}
        />
        <OutboundLabelsSearchHandoffCard
          searchQuery={searchQuery}
          onOpenLabelsMatches={onOpenLabelsMatches}
        />
      </motion.div>
    </SidebarShell>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-surface-card">{content}</div>;
  }

  return (
    <aside className="bg-surface-card text-text-default flex-shrink-0 h-full overflow-hidden border-r border-border-soft relative w-[300px]">
      {content}
    </aside>
  );
}
