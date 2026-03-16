'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ShippedFormData } from '@/components/shipped';
import { ShippedIntakeForm } from '@/components/shipped/ShippedIntakeForm';
import { Package, Plus, RotateCcw } from '@/components/Icons';
import { motion } from 'framer-motion';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SearchBar } from '@/components/ui/SearchBar';

interface UnshippedSidebarProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  embedded?: boolean;
  hideSectionHeader?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
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
    <>
      {filterControl ? (
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="relative z-20">
          {filterControl}
        </motion.div>
      ) : null}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className={`h-full flex flex-col overflow-y-auto no-scrollbar px-6 pb-6 ${filterControl ? 'pt-4' : 'pt-6'}`}
      >
        {!hideSectionHeader ? (
          <motion.header variants={itemVariants}>
            <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
              Unshipped
            </h2>
            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
              Shipping Queue
            </p>
          </motion.header>
        ) : null}

        <motion.div variants={itemVariants} className={`${hideSectionHeader ? '' : 'mt-4'} space-y-4`}>
          <SearchBar
            value={searchQuery}
            onChange={handleInputChange}
            onSearch={handleSearch}
            onClear={() => { setSearchQuery(''); handleSearch(''); }}
            inputRef={searchInputRef}
            placeholder="Search orders, serials..."
            variant="blue"
            rightElement={
              <button
                type="button"
                onClick={handleOpenIntakeForm}
                className="p-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                title="New Order Entry"
                aria-label="Open new order entry form"
              >
                <Plus className="w-4 h-4" />
              </button>
            }
          />
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
        </motion.div>

        <motion.section variants={itemVariants} className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wider text-blue-900">
                Mock ShipStation Import
              </p>
              <p className="text-[10px] font-bold text-blue-700 mt-1">
                Import source: ShipStation staging feed
              </p>
              <p className="text-[10px] font-medium text-blue-800/90 mt-2 leading-relaxed">
                Showing orders missing tracking numbers. Use this mock panel to validate unshipped flow and shipping readiness.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mt-3 w-full h-9 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Run Mock Import
          </button>
        </motion.section>

        <motion.section variants={itemVariants} className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-700">Shipping Mock Details</p>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Carrier Mix</span>
            <span>USPS / UPS / FedEx</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Label Status</span>
            <span>Awaiting Generation</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Cutoff Window</span>
            <span>4:00 PM PST</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-600">
            <span>Batch Grouping</span>
            <span>By Ship-By Date</span>
          </div>
        </motion.section>
      </motion.div>
    </>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-white">{content}</div>;
  }

  return (
    <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative w-[300px]">
      {content}
    </aside>
  );
}
