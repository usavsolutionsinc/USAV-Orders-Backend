'use client';

import { useEffect, useMemo, useState } from 'react';
import PackerDashboard from '@/components/PackerDashboard';
import { MobileStationPacking } from '@/components/mobile/station/MobileStationPacking';
import { RouteShell } from '@/design-system/components/RouteShell';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useQueryClient } from '@tanstack/react-query';

interface PackerPageContentProps {
  packerId: string;
}

/**
 * Single responsive tree. Desktop renders the PackerDashboard (table + details).
 * Mobile flips Actions ↔ History: Actions = packing station flow, History = dashboard.
 * The mobile packing station/scan/camera flow is preserved as-is per scope.
 */
export function PackerPageContent({ packerId }: PackerPageContentProps) {
  useRealtimeToasts('packer');
  const queryClient = useQueryClient();
  const staffDirectory = useActiveStaffDirectory();
  const [dailyGoal, setDailyGoal] = useState(50);

  useEffect(() => {
    getStaffGoalById(packerId).then(setDailyGoal).catch(() => {});
  }, [packerId]);

  const packerName = useMemo(
    () => staffDirectory.find((m) => String(m.id) === String(packerId))?.name || 'Packer',
    [staffDirectory, packerId],
  );

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ['packer-logs'] });
  };

  return (
    <RouteShell
      defaultView="actions"
      actionsLabel="Station"
      actions={
        <MobileStationPacking
          userId={packerId}
          userName={packerName}
          staffId={packerId}
          todayCount={0}
          goal={dailyGoal}
          onComplete={refreshHistory}
          suppressShellToolbar
          suppressBottomActionBar
        />
      }
      history={<PackerDashboard packerId={packerId} />}
    />
  );
}
