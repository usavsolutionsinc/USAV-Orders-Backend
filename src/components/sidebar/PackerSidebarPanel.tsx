'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import StaffSelector from '@/components/StaffSelector';
import StationPacking from '@/components/station/StationPacking';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { useActiveStaffDirectory } from './hooks';

export function PackerSidebarPanel() {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(50);
  const [staffIdNum] = usePersistedStaffId({ storageKey: 'packer-staff-id' });
  const packerId = String(staffIdNum);
  const staffDirectory = useActiveStaffDirectory();

  const packerMember = staffDirectory.find((m) => String(m.id) === packerId);
  const packerName = packerMember?.name || 'Packer';
  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setHistory(data);
      } catch {
        // no-op
      } finally {
        setLoading(false);
      }
    };

    getStaffGoalById(packerId).then(setDailyGoal).catch(() => {});
    fetchHistory();
  }, [packerId]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter(
      (item) => toPSTDateKey(item.created_at || item.timestamp || item.packedAt || '') === todayDate,
    ).length;
  }, [history]);

  const refreshHistory = async () => {
    try {
      const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch {
      // no-op
    }
  };

  if (loading && history.length === 0) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-white">
        <div className={sidebarHeaderBandClass}>
          <div className="h-11 w-full bg-zinc-50 animate-pulse" />
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
    <div className="h-full flex flex-col overflow-hidden">
      <div className={sidebarHeaderBandClass}>
        <div className="grid grid-cols-1">
          <StaffSelector
            role="all"
            variant="boxy"
            selectedStaffId={parseInt(packerId, 10)}
            onSelect={(id) => router.push(`/packer?staffId=${id}`)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <StationPacking
          embedded
          userId={packerId}
          userName={packerName}
          staffId={packerId}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}
