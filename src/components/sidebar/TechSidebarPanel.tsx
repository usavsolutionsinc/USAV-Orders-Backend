'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
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
  const staffDirectory = useActiveStaffDirectory();

  const techName = staffDirectory.find((m) => String(m.id) === String(techId))?.name || 'Technician';
  const techTheme = getTechThemeById(techId);

  const rawView = searchParams.get('view');
  const viewMode: TechViewMode =
    rawView === 'pending'
      ? 'pending'
      : rawView === 'manual'
        ? 'manual'
        : rawView === 'update-manuals'
          ? 'update-manuals'
          : 'history';

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
      (item) => toPSTDateKey(item.test_date_time || item.timestamp || '') === todayDate,
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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white">
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
              buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
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
    </div>
  );
}
