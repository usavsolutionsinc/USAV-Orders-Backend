'use client';

import { useEffect, useMemo, useState } from 'react';
import StationPacking from '@/components/station/StationPacking';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveStaffDirectory } from './hooks';

export function PackerSidebarPanel() {
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const { user } = useAuth();
  const staffIdNum = user?.staffId ?? 0;
  const packerId = String(staffIdNum);
  const staffDirectory = useActiveStaffDirectory();

  const packerMember = staffDirectory.find((m) => String(m.id) === packerId);
  const packerName = packerMember?.name || 'Packer';

  useEffect(() => {
    if (staffIdNum <= 0) return;

    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=100`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setHistory(data);
      } catch {
        // no-op
      }
    };

    getStaffGoalById(packerId).then((g) => { if (!cancelled) setDailyGoal(g); }).catch(() => {});
    fetchHistory();

    return () => { cancelled = true; };
  }, [packerId, staffIdNum]);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const todayDate = getCurrentPSTDateKey();
    return history.filter(
      (item) => toPSTDateKey(item.created_at || item.timestamp || item.packedAt || '') === todayDate,
    ).length;
  }, [history]);

  const refreshHistory = async () => {
    if (staffIdNum <= 0) return;
    try {
      const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=100`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch {
      // no-op
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
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
