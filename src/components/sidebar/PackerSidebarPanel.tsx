'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import StaffSelector from '@/components/StaffSelector';
import StationPacking from '@/components/station/StationPacking';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { getPackerThemeById } from '@/utils/staff-colors';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useActiveStaffDirectory } from './hooks';

export function PackerSidebarPanel({ packerId }: { packerId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();

  const packerName = staffDirectory.find((m) => String(m.id) === String(packerId))?.name || 'Packer';
  const packerTheme = getPackerThemeById(packerId);

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
      (item) => toPSTDateKey(item.pack_date_time || item.timestamp || item.packedAt || '') === todayDate,
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
      <div className="border-b border-gray-200 bg-white">
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
          themeColor={packerTheme}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
        />
      </div>
    </div>
  );
}
