'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarHeaderBandClass, sidebarHeaderControlClass } from '@/components/layout/header-shell';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import StaffSelector from '@/components/StaffSelector';
import StationTesting from '@/components/station/StationTesting';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useTechLogs, type TechRecord } from '@/hooks/useTechLogs';
import { useActiveStaffDirectory } from './hooks';

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

const TECH_VIEW_OPTIONS = [
  { value: 'history', label: 'Tech History' },
  { value: 'shipped', label: 'Shipped Orders' },
  { value: 'pending', label: 'Pending Orders' },
  { value: 'manual', label: 'Last Order Manual' },
  { value: 'update-manuals', label: 'Update Manuals' },
] as const;

type TechViewMode = 'history' | 'shipped' | 'pending' | 'manual' | 'update-manuals';

export function TechSidebarPanel({ techId }: { techId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();

  const techMember = staffDirectory.find((m) => String(m.id) === String(techId));
  const techName = techMember?.name || 'Technician';
  const rawView = searchParams.get('view');
  const viewMode: TechViewMode =
    rawView === 'pending'
      ? 'pending'
      : rawView === 'shipped'
        ? 'shipped'
        : rawView === 'manual'
          ? 'manual'
          : rawView === 'update-manuals'
            ? 'update-manuals'
            : 'history';

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
    if (nextView === 'history') {
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

  const refreshHistory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tech-logs', parseInt(techId, 10)] });
  }, [queryClient, techId]);

  if (isLoading && records.length === 0) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
        <div className={sidebarHeaderBandClass}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-200">
            <div className="h-11 bg-zinc-50 animate-pulse" />
            <div className="h-11 bg-zinc-50 animate-pulse" />
          </div>
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
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-gray-400">
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <StationTesting
          embedded
          userId={techId}
          userName={techName}
          staffId={techId}
          onTrackingScan={() => updateViewMode('history')}
          onViewManual={() => updateViewMode('manual')}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}
