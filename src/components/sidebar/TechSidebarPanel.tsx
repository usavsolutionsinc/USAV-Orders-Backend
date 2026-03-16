'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, X } from '@/components/Icons';
import { sidebarHeaderBandClass, sidebarHeaderControlClass } from '@/components/layout/header-shell';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { SearchBar } from '@/components/ui/SearchBar';
import StaffSelector from '@/components/StaffSelector';
import StationTesting from '@/components/station/StationTesting';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getTechThemeById } from '@/utils/staff-colors';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useActiveStaffDirectory } from './hooks';

const TECH_VIEW_OPTIONS = [
  { value: 'history', label: 'Tech History' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'manual', label: 'Last Order Manual' },
  { value: 'update-manuals', label: 'Update Manuals' },
] as const;

type TechViewMode = 'history' | 'pending' | 'manual' | 'update-manuals';

export function TechSidebarPanel({ techId }: { techId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const staffDirectory = useActiveStaffDirectory();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const techName = staffDirectory.find((m) => String(m.id) === String(techId))?.name || 'Technician';
  const techTheme = getTechThemeById(techId);

  const rawView = searchParams.get('view');
  const currentSearch = String(searchParams.get('search') || '');
  const viewMode: TechViewMode =
    rawView === 'pending'
      ? 'pending'
      : rawView === 'manual'
        ? 'manual'
        : rawView === 'update-manuals'
          ? 'update-manuals'
          : 'history';

  useEffect(() => {
    setSearchInput(currentSearch);
    setSearchExpanded(Boolean(currentSearch));
  }, [currentSearch]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/tech-logs?techId=${techId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setHistory(data);
      } catch {
        // no-op
      }
    };

    getStaffGoalById(techId).then(setDailyGoal).catch(() => {});
    fetchHistory();
  }, [techId]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter(
      (item) => toPSTDateKey(item.created_at || item.test_date_time || item.timestamp || '') === todayDate,
    ).length;
  }, [history]);

  const updateViewMode = (nextView: TechViewMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    if (nextView === 'history') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  const updatePendingSearch = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    nextParams.set('view', 'pending');
    if (value.trim()) {
      nextParams.set('search', value.trim());
    } else {
      nextParams.delete('search');
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const normalizedCurrent = currentSearch.trim();
      const normalizedNext = searchInput.trim();
      if (viewMode === 'pending' && normalizedCurrent === normalizedNext) return;
      updatePendingSearch(searchInput);
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput, currentSearch, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!searchExpanded) return;
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timeoutId);
  }, [searchExpanded]);

  const openPendingSearch = () => {
    setSearchExpanded(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    nextParams.set('view', 'pending');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  const clearPendingSearch = () => {
    setSearchInput('');
    setSearchExpanded(false);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    nextParams.delete('search');
    if (viewMode === 'pending') {
      nextParams.delete('view');
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  const refreshHistory = async () => {
    try {
      const res = await fetch(`/api/tech-logs?techId=${techId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch {
      // no-op
    }
  };

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
          <div className="min-w-0">
            <StaffSelector
              role="technician"
              variant="boxy"
              selectedStaffId={parseInt(techId, 10)}
              onSelect={(id) => router.push(`/tech?staffId=${id}`)}
            />
          </div>
          <div className="relative min-w-0">
            <ViewDropdown
              options={TECH_VIEW_OPTIONS}
              value={viewMode}
              onChange={(nextView) => updateViewMode(nextView as TechViewMode)}
              variant="boxy"
              buttonClassName={sidebarHeaderControlClass}
              optionClassName="text-[10px] font-black tracking-wider"
            />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <StationTesting
          embedded
          userId={techId}
          userName={techName}
          themeColor={techTheme}
          onTrackingScan={() => updateViewMode('history')}
          onViewManual={() => updateViewMode('manual')}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-30">
        <AnimatePresence initial={false} mode="wait">
          {searchExpanded ? (
            <motion.div
              key="expanded-tech-search"
              initial={{ width: prefersReducedMotion ? 280 : 56, opacity: 0.7 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: prefersReducedMotion ? 56 : 280, opacity: 0.72 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto w-[320px]"
            >
              <SearchBar
                  value={searchInput}
                  onChange={setSearchInput}
                  inputRef={inputRef}
                  placeholder="Search pending orders"
                  variant="orange"
                  size="compact"
                  className="w-full"
                  onClear={clearPendingSearch}
                  rightElement={
                    <button
                      type="button"
                      onClick={clearPendingSearch}
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                      aria-label="Close pending order search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  }
              />
            </motion.div>
          ) : (
            <motion.button
              key="collapsed-tech-search"
              type="button"
              initial={{ opacity: 0.86, x: 0 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0.72, x: -10 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={openPendingSearch}
              className="pointer-events-auto flex h-12 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-gray-700 shadow-sm hover:bg-gray-50"
              aria-label="Open pending order search"
            >
              <Search className="h-4 w-4" />
              <span className="text-[11px] font-black uppercase tracking-wider">Search</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
