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
  const [dailyGoal, setDailyGoal] = useState(50);
  const [staffIdNum] = usePersistedStaffId({ storageKey: 'packer-staff-id' });
  const packerId = String(staffIdNum);
  const staffDirectory = useActiveStaffDirectory();

  const packerMember = staffDirectory.find((m) => String(m.id) === packerId);
  const packerName = packerMember?.name || 'Packer';
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setHistory(data);
      } catch {
        // no-op
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
