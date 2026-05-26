'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import StationTesting from '@/components/station/StationTesting';
import { TestingSidebarPanel } from '@/components/sidebar/TestingSidebarPanel';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useTechLogs, type TechRecord } from '@/hooks/useTechLogs';
import { ChevronLeft } from '@/components/Icons';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { useActiveStaffDirectory } from './hooks';
import {
  TECH_STATION_VIEW_ITEMS,
  TECH_STATION_VIEW_SLIDER_NONE,
  TECH_TOP_MODE_ITEMS,
  type TechStationViewMode,
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

function isFbaTechRecord(record: TechRecord): boolean {
  return (
    record.source_kind === 'fba_scan' ||
    record.account_source === 'fba' ||
    Boolean(String(record.fnsku || '').trim()) ||
    String(record.order_id || '').toUpperCase() === 'FBA'
  );
}

function deduplicateByTracking(records: TechRecord[]): TechRecord[] {
  const sorted = [...records].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
  const trackingIndex = new Map<string, number>();
  const unique: TechRecord[] = [];
  for (const record of sorted) {
    // FBA scans: each is a separate unit, never deduplicate
    if (isFbaTechRecord(record)) { unique.push(record); continue; }
    const key = String(record.shipping_tracking_number || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!key) { unique.push(record); continue; }
    if (!trackingIndex.has(key)) {
      trackingIndex.set(key, unique.length);
      unique.push(record);
    }
  }
  return unique;
}

type TechViewMode = TechStationViewMode;

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
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();

  const techMember = staffDirectory.find((m) => String(m.id) === String(techId));
  const techName = techMember?.name || 'Technician';
  const viewParam = searchParams.get('view');
  /**
   * `view=testing` flips the entire sidebar (and right pane) into the
   * Testing top-mode; everything else stays in Shipping with `viewMode`
   * driving which right-panel table renders.
   */
  const topMode: TechSidebarTopMode = viewParam === 'testing' ? 'testing' : 'shipping';
  /** Shipped is the default; history/pending require explicit `?view=`. Only used in Shipping mode. */
  const viewMode: TechViewMode =
    viewParam === 'pending'
      ? 'pending'
      : viewParam === 'history'
        ? 'history'
        : 'shipped';

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

  // Fetch goal on mount / when techId changes
  useEffect(() => {
    getStaffGoalById(techId).then(setDailyGoal).catch(() => {});
  }, [techId]);

  // Use the same hook + week range as TechTable so counts always match
  const weekRange = useMemo(() => computeCurrentWeekRange(), []);
  const { data: records = [], isLoading } = useTechLogs(parseInt(techId, 10), { weekOffset: 0, weekRange });

  const todayCount = useMemo(() => {
    const todayDate = getCurrentPSTDateKey();
    const todayRecords = records.filter(
      (r) => toPSTDateKey(r.created_at || '') === todayDate,
    );
    return deduplicateByTracking(todayRecords).length;
  }, [records]);

  const updateViewMode = (nextView: TechViewMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    if (nextView === 'shipped') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    if (nextView !== 'pending' && nextView !== 'shipped') {
      nextParams.delete('search');
      nextParams.delete('searchOpen');
    }
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
  };

  /**
   * Switch the top-level mode. `shipping` clears `view=testing` and lets
   * the default (shipped) reassert; `testing` sets `view=testing` which is
   * the same param `TechDashboard` already branches on.
   */
  const updateTopMode = (next: TechSidebarTopMode) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', techId);
    if (next === 'testing') {
      nextParams.set('view', 'testing');
      nextParams.delete('search');
      nextParams.delete('searchOpen');
    } else {
      // Drop `view=testing`; keep history/pending/shipped untouched so the
      // tech doesn't lose their sub-mode when bouncing between top modes.
      if (nextParams.get('view') === 'testing') nextParams.delete('view');
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
        <div className="flex-1 p-4 space-y-4">
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
      {/* Band 1: optional back chevron + section label (mobile context nav) */}
      <div className={sidebarHeaderBandClass}>
        {onBackToAppNav ? (
          <button
            type="button"
            onClick={onBackToAppNav}
            className="flex w-full min-h-[44px] items-center gap-2 border-b border-gray-200 py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-gray-50"
            aria-label="Back to app navigation"
          >
            <div className="flex h-9 w-7 items-center justify-start text-gray-500">
              <ChevronLeft className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black tracking-tight text-gray-900">
                {contextNavTitle}
              </p>
            </div>
          </button>
        ) : null}
      </div>

      {/* Band 2: top mode pills [Shipping | Testing]. Mirrors the receiving
          sidebar's mode-row above the scan bar so the tech's primary mode
          switch lives in the exact same visual location as receiving's. */}
      <div className={`${sidebarHeaderBandClass} px-3`}>
        <HorizontalButtonSlider
          items={TECH_TOP_MODE_ITEMS}
          value={topMode}
          onChange={(next) => updateTopMode(next as TechSidebarTopMode)}
          variant="nav"
          aria-label="Tech sidebar mode"
        />
      </div>

      {/* Body — Testing top mode owns a lean scan-bar + recent rail shell;
          Shipping mode keeps the full StationTesting welcome/goal/queue
          surface plus its icon-only sub-mode switcher (history/shipped/
          pending). The parent owns chrome (bands 1 + 2); child renders
          only the body. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {topMode === 'testing' ? (
          <TestingSidebarPanel staffId={techId} />
        ) : (
          <StationTesting
            embedded
            userId={techId}
            userName={techName}
            staffId={techId}
            onTrackingScan={() => updateViewMode('history')}
            techViewSwitcher={{
              items: TECH_STATION_VIEW_ITEMS,
              value:
                viewParam === 'receiving' ? TECH_STATION_VIEW_SLIDER_NONE : viewMode,
              onChange: updateViewMode,
            }}
            todayCount={todayCount}
            goal={dailyGoal}
            onComplete={refreshHistory}
          />
        )}
      </div>
    </div>
  );
}
