'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import StationPacking from '@/components/station/StationPacking';
import { AlertTriangle, Box, Boxes } from '@/components/Icons';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useAuth } from '@/contexts/AuthContext';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useActiveStaffDirectory } from './hooks';

/** Pack modes the operator can switch between at the top of the sidebar. */
type PackMode = 'standard' | 'fragile' | 'multi';

const PACK_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'standard', label: 'Standard', icon: Box },
  { id: 'fragile',  label: 'Fragile', icon: AlertTriangle },
  { id: 'multi',    label: 'Multi-Item', icon: Boxes },
];

export function PackerSidebarPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<any[]>([]);
  const [dailyGoal, setDailyGoal] = useState(50);
  const { user } = useAuth();
  const staffIdNum = user?.staffId ?? 0;
  const packerId = String(staffIdNum);
  const staffDirectory = useActiveStaffDirectory();
  const masterNavEnabled = useMasterNavEnabled();

  // Pack mode — persisted via ?packMode= URL param so refresh/sharing preserves it.
  const rawMode = searchParams.get('packMode') ?? 'standard';
  const packMode: PackMode = rawMode === 'fragile' ? 'fragile' : rawMode === 'multi' ? 'multi' : 'standard';

  const setPackMode = (next: PackMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'standard') params.delete('packMode');
    else params.set('packMode', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard');
  };

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
      {/* Mode rail — Standard / Fragile / Multi-Item. Hidden when the master-nav
          L2 ModeRail is the single switcher (see MASTER_NAV_RAIL_PAGES). */}
      {!masterNavEnabled && (
        <div className={`shrink-0 border-b border-gray-100 ${SIDEBAR_GUTTER} py-1.5`}>
          <HorizontalButtonSlider
            items={PACK_MODE_ITEMS}
            value={packMode}
            onChange={(id) => setPackMode(id as PackMode)}
            variant="segmented"
            aria-label="Pack mode"
            className="w-full"
          />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <StationPacking
          embedded
          userId={packerId}
          userName={packerName}
          staffId={packerId}
          todayCount={todayCount}
          goal={dailyGoal}
          onComplete={refreshHistory}
          packMode={packMode}
        />
      </div>
    </div>
  );
}
