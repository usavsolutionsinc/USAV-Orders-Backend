'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MobileStationTesting } from '../station/MobileStationTesting';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { useTechLogs, type TechRecord } from '@/hooks/useTechLogs';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';

// ─── Helpers (same as TechSidebarPanel) ─────────────────────────────────────

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

function deduplicateByTracking(records: TechRecord[]): TechRecord[] {
  const sorted = [...records].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
  const trackingIndex = new Map<string, number>();
  const unique: TechRecord[] = [];
  for (const record of sorted) {
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface MobileTechDashboardProps {
  techId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileTechDashboard — mobile orchestrator for the tech station.
 *
 * Phase 1: renders MobileStationTesting full-screen.
 * Future: add bottom nav tabs for history, pending orders, etc.
 */
export function MobileTechDashboard({ techId }: MobileTechDashboardProps) {
  const queryClient = useQueryClient();
  const [dailyGoal, setDailyGoal] = useState(50);
  const staffDirectory = useActiveStaffDirectory();

  const techMember = staffDirectory.find((m) => String(m.id) === String(techId));
  const techName = techMember?.name || 'Technician';

  // Fetch goal on mount / when techId changes
  useEffect(() => {
    getStaffGoalById(techId).then(setDailyGoal).catch(() => {});
  }, [techId]);

  // Use the same hook + week range as TechTable so counts always match
  const weekRange = useMemo(() => computeCurrentWeekRange(), []);
  const { data: records = [] } = useTechLogs(parseInt(techId, 10), { weekOffset: 0, weekRange });

  const todayCount = useMemo(() => {
    const todayDate = getCurrentPSTDateKey();
    const todayRecords = records.filter(
      (r) => toPSTDateKey(r.created_at || '') === todayDate,
    );
    return deduplicateByTracking(todayRecords).length;
  }, [records]);

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
  };

  return (
    <MobileStationTesting
      userId={techId}
      userName={techName}
      staffId={techId}
      todayCount={todayCount}
      goal={dailyGoal}
      onComplete={refreshHistory}
    />
  );
}
