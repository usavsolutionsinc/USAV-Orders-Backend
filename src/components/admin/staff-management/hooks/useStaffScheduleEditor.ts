import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { toast } from '@/lib/toast';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import type { StaffScheduleMatrixDay } from '@/lib/staff-availability';
import type {
  ScheduleMap,
  PendingScheduleMap,
  StaffScheduleUpdatePayload,
  StaffScheduleBulkPayload,
  StaffWeekScheduleUpdatePayload,
  StaffWeekCopyPayload,
} from '@/hooks/admin/useStaffScheduleData';
import type { Staff } from '../../types';
import type { StaffRole } from '../constants';

interface UseStaffScheduleEditorArgs {
  scheduleMap: ScheduleMap;
  thisWeekDays: StaffScheduleMatrixDay[];
  nextWeekStartDate: string;
  /** The currently visible staff list — bulk role actions operate on this set. */
  filteredStaff: Staff[];
}

/**
 * Owns the optimistic / pending schedule state machine: per-cell optimistic
 * toggles, the 5-second debounced single-cell save with undo, immediate
 * next-week saves and bulk-by-role application. Schedule-related mutations live
 * here too so the cache-invalidation contract stays in one place.
 */
export function useStaffScheduleEditor({
  scheduleMap,
  thisWeekDays,
  nextWeekStartDate,
  filteredStaff,
}: UseStaffScheduleEditorArgs) {
  const queryClient = useQueryClient();
  const [savingScheduleKey, setSavingScheduleKey] = useState<string | null>(null);
  const [optimisticScheduleMap, setOptimisticScheduleMap] = useState<ScheduleMap>({});
  const [pendingScheduleMap, setPendingScheduleMap] = useState<PendingScheduleMap>({});
  const pendingScheduleMapRef = useRef<PendingScheduleMap>({});

  const updateScheduleMutation = useMutation({
    mutationFn: async (data: StaffScheduleUpdatePayload) => {
      const res = await fetch('/api/staff/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to update schedule');
      }
      return res.json();
    },
    onMutate: (variables) => {
      setSavingScheduleKey(`${variables.staffId}:${variables.scheduleDate || variables.dayOfWeek}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
    },
    onSettled: () => {
      setSavingScheduleKey(null);
    },
  });

  const updateWeekScheduleMutation = useMutation({
    mutationFn: async (data: StaffWeekScheduleUpdatePayload) => {
      const res = await fetch('/api/staff/schedule/week', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to update next week schedule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
    },
  });

  const copyWeekScheduleMutation = useMutation({
    mutationFn: async (data: StaffWeekCopyPayload) => {
      const res = await fetch('/api/staff/schedule/week/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to copy week schedule');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      toast.success(
        variables.mode === 'template'
          ? 'Next week copied from weekly template'
          : 'Next week copied from this week'
      );
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to copy week schedule');
    },
  });

  const bulkScheduleMutation = useMutation({
    mutationFn: async (data: StaffScheduleBulkPayload) => {
      const res = await fetch('/api/staff/schedule/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to bulk update schedule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      toast.success('Schedule updated');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update schedule');
    },
  });

  useEffect(() => {
    pendingScheduleMapRef.current = pendingScheduleMap;
  }, [pendingScheduleMap]);

  useEffect(() => {
    return () => {
      Object.values(pendingScheduleMapRef.current).forEach((entry) => clearTimeout(entry.timerId));
    };
  }, []);

  const getIsScheduled = (staffId: number, scheduleDate: string) => {
    const optimistic = optimisticScheduleMap[staffId]?.[scheduleDate];
    if (optimistic !== undefined) return optimistic;
    return scheduleMap[staffId]?.[scheduleDate] ?? true;
  };

  const clearPendingSchedule = (key: string) => {
    setPendingScheduleMap((prev) => {
      const current = prev[key];
      if (current?.timerId) clearTimeout(current.timerId);
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const applyOptimisticSchedule = (staffId: number, scheduleDate: string, isScheduled: boolean) => {
    setOptimisticScheduleMap((prev) => ({
      ...prev,
      [staffId]: {
        ...(prev[staffId] || {}),
        [scheduleDate]: isScheduled,
      },
    }));
  };

  const rollbackOptimisticSchedule = (staffId: number, scheduleDate: string, isScheduled: boolean) => {
    applyOptimisticSchedule(staffId, scheduleDate, isScheduled);
  };

  const flushSingleScheduleUpdate = (
    staffId: number,
    dayOfWeek: StaffDayOfWeek,
    scheduleDate: string,
    previous: boolean,
    isScheduled: boolean,
    key: string
  ) => {
    updateScheduleMutation.mutate(
      { staffId, dayOfWeek, scheduleDate, isScheduled },
      {
        onSuccess: () => {
          clearPendingSchedule(key);
          setOptimisticScheduleMap((prev) => {
            const next = { ...prev };
            if (next[staffId]) {
              const nextRow = { ...next[staffId] };
              delete nextRow[scheduleDate];
              next[staffId] = nextRow;
            }
            return next;
          });
        },
        onError: (error: any) => {
          rollbackOptimisticSchedule(staffId, scheduleDate, previous);
          clearPendingSchedule(key);
          toast.error(error?.message || 'Failed to update schedule');
        },
      }
    );
  };

  const queueSingleScheduleUpdate = (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string, previous: boolean, next: boolean) => {
    const key = `${staffId}:${scheduleDate}`;
    clearPendingSchedule(key);
    applyOptimisticSchedule(staffId, scheduleDate, next);

    const timerId = setTimeout(() => {
      flushSingleScheduleUpdate(staffId, dayOfWeek, scheduleDate, previous, next, key);
    }, 5000);

    setPendingScheduleMap((prev) => ({
      ...prev,
      [key]: { staffId, dayOfWeek, scheduleDate, previous, next, timerId },
    }));

    toast.message('Schedule will save in 5s', {
      action: {
        label: 'Undo',
        onClick: () => {
          rollbackOptimisticSchedule(staffId, scheduleDate, previous);
          clearPendingSchedule(key);
          toast.success('Schedule change undone');
        },
      },
      duration: 5000,
    } as any);
  };

  const toggleSchedule = (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string, isActive: boolean) => {
    if (!isActive) return;
    const current = getIsScheduled(staffId, scheduleDate);
    queueSingleScheduleUpdate(staffId, dayOfWeek, scheduleDate, current, !current);
  };

  const toggleNextWeekSchedule = (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string, isActive: boolean) => {
    if (!isActive || !nextWeekStartDate) return;
    const current = getIsScheduled(staffId, scheduleDate);
    const next = !current;
    const key = `${staffId}:${scheduleDate}`;
    setSavingScheduleKey(key);
    applyOptimisticSchedule(staffId, scheduleDate, next);
    updateWeekScheduleMutation.mutate(
      {
        staffId,
        weekStartDate: nextWeekStartDate,
        dayOfWeek,
        isScheduled: next,
      },
      {
        onSettled: () => {
          setSavingScheduleKey(null);
        },
        onSuccess: () => {
          setOptimisticScheduleMap((prev) => {
            const row = prev[staffId];
            if (!row || !(scheduleDate in row)) return prev;
            const nextMap = { ...prev };
            const nextRow = { ...row };
            delete nextRow[scheduleDate];
            nextMap[staffId] = nextRow;
            return nextMap;
          });
        },
        onError: (error: any) => {
          rollbackOptimisticSchedule(staffId, scheduleDate, current);
          toast.error(error?.message || 'Failed to update next week schedule');
        },
      }
    );
  };

  const applyBulkByRole = (role: StaffRole, isScheduled: boolean) => {
    const target = filteredStaff.filter((member) => member.role === role && member.active);
    if (!target.length) {
      toast.message(`No active ${role}s to update`);
      return;
    }

    const updates = target.flatMap((member) =>
      thisWeekDays.map((day) => ({
        staffId: member.id,
        dayOfWeek: day.dayOfWeek,
        scheduleDate: day.date,
        isScheduled,
      }))
    );

    setOptimisticScheduleMap((prev) => {
      const next = { ...prev };
      for (const member of target) {
        next[member.id] = thisWeekDays.reduce<Record<string, boolean>>((acc, day) => {
          acc[day.date] = isScheduled;
          return acc;
        }, { ...(next[member.id] || {}) });
      }
      return next;
    });
    bulkScheduleMutation.mutate({ updates });
  };

  return {
    savingScheduleKey,
    getIsScheduled,
    toggleSchedule,
    toggleNextWeekSchedule,
    applyBulkByRole,
    copyWeekScheduleMutation,
    updateWeekScheduleMutation,
  };
}
