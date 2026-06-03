'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarHeaderBandClass, sidebarHeaderPillRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import StationTesting from '@/components/station/StationTesting';
import { TestingSidebarPanel } from '@/components/sidebar/TestingSidebarPanel';
import { getCurrentPSTDateKey } from '@/utils/date';
import { useTechLogs } from '@/hooks/useTechLogs';
import { ChevronDown, ChevronLeft, History, Wrench } from '@/components/Icons';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useActiveStaffDirectory } from './hooks';
import {
  TECH_TOP_MODE_ITEMS,
  type TechSidebarTopMode,
} from './tech-station-view-config';

function computeCurrentWeekRange() {
  const todayPst = getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

interface TechSidebarPanelProps {
  techId: string;
  /** Opens the main app page list in the sidebar (Main / Stations / More) — same as the desktop sidebar chevron, not a route to `/dashboard`. */
  onBackToAppNav?: () => void;
  /** Label next to the chevron (e.g. "Testing"). */
  contextNavTitle?: string;
}

export function TechSidebarPanel({ techId, onBackToAppNav, contextNavTitle = 'Testing' }: TechSidebarPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const staffDirectory = useActiveStaffDirectory();
  // When the master nav owns mode switching, its L2 rail replaces this panel's
  // own Shipping/Testing pills (avoids a double switcher).
  const masterNavEnabled = useMasterNavEnabled();

  const techMember = staffDirectory.find((m) => String(m.id) === String(techId));
  const techName = techMember?.name || 'Technician';
  const viewParam = searchParams.get('view');
  /**
   * `view=testing` flips the sidebar (and right pane) into the Testing
   * top-mode; `view=testing-history` into the History feed; everything else
   * stays in Shipping, whose right pane is fixed to the shipping History feed.
   */
  const topMode: TechSidebarTopMode =
    viewParam === 'testing'
      ? 'testing'
      : viewParam === 'testing-history'
        ? 'history'
        : 'shipping';

  // Normalize legacy / removed query values on `view`.
  useEffect(() => {
    const v = searchParams.get('view');
    if (v !== 'manual' && v !== 'update-manuals') return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('view');
    nextParams.set('staffId', techId);
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  }, [searchParams, router, techId]);

  // Use the same hook + week range as TechTable so the sidebar shares its
  // loading state (the skeleton below keys off `records`/`isLoading`).
  const weekRange = useMemo(() => computeCurrentWeekRange(), []);
  const { data: records = [], isLoading } = useTechLogs(parseInt(techId, 10), { weekOffset: 0, weekRange });

  /**
   * Switch the top-level mode. `shipping` clears `view` and falls back to the
   * shipping History feed; `testing` sets `view=testing`; `history` sets
   * `view=testing-history` — the same params `TechDashboard` branches on.
   */
  const updateTopMode = (next: TechSidebarTopMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    if (next === 'testing' || next === 'history') {
      nextParams.set('view', next === 'testing' ? 'testing' : 'testing-history');
      nextParams.delete('search');
      nextParams.delete('searchOpen');
    } else {
      // Drop the testing `view` so Shipping reasserts its History feed.
      const v = nextParams.get('view');
      if (v === 'testing' || v === 'testing-history') nextParams.delete('view');
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  const refreshHistory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tech-logs', parseInt(techId, 10)] });
  }, [queryClient, techId]);

  if (isLoading && records.length === 0) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
        <div className={sidebarHeaderBandClass}>
          {onBackToAppNav ? (
            <div className="flex min-h-[44px] w-full border-b border-gray-200 bg-zinc-50 animate-pulse" />
          ) : null}
        </div>
        <div className={`flex-1 ${SIDEBAR_GUTTER} py-4 space-y-4`}>
          <div className="h-24 w-full rounded-2xl bg-zinc-100 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-24 bg-zinc-100 rounded animate-pulse" />
            <div className="h-10 w-full rounded-xl bg-zinc-100 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-32 bg-zinc-100 rounded animate-pulse" />
            <div className="h-32 w-full rounded-2xl bg-zinc-100 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      {/* Band 2: top mode pills [Shipping | Testing]. Mirrors the receiving
  ...
          sidebar's mode-row above the scan bar so the tech's primary mode
          switch lives in the exact same visual location as receiving's. */}
      {!masterNavEnabled && (
        <div className={sidebarHeaderPillRowClass}>
          <HorizontalButtonSlider
            items={TECH_TOP_MODE_ITEMS}
            value={topMode}
            onChange={(next) => updateTopMode(next as TechSidebarTopMode)}
            variant="nav"
            dense
            className="w-full"
            aria-label="Tech sidebar mode"
          />
        </div>
      )}

      {/* Body — Testing top mode owns a lean scan-bar + recent rail shell;
          Shipping mode renders the StationTesting scan bar + UpNext queue. The
          right pane is fixed to the History feed (the active/preview order
          crossfades over it in TechDashboard); there is no sub-mode switcher.
          The parent owns chrome (bands 1 + 2); child renders only the body. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {topMode === 'testing' ? (
          <TestingSidebarPanel staffId={techId} />
        ) : topMode === 'history' ? (
          // History is browse-only — the tested-lines feed lives in the right
          // pane (TestingHistoryList); the sidebar just orients the tech.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <History className="h-6 w-6 text-gray-300" />
            <p className="text-sm font-semibold text-gray-500">Browsing your tested lines</p>
            <p className="text-caption text-gray-400">
              Use <span className="font-bold text-gray-600">Select</span> in the top bar to pick lines and act on them.
            </p>
          </div>
        ) : (
          <StationTesting
            embedded
            userId={techId}
            userName={techName}
            staffId={techId}
            onComplete={refreshHistory}
          />
        )}
      </div>
    </div>
  );
}
