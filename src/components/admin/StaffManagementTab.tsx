'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import type { Staff, StaffAvailabilityRule } from './types';
import { toast } from '@/lib/toast';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStaffChannelName } from '@/lib/realtime/channels';
import { getCurrentPSTDateKey } from '@/utils/date';
import { sectionLabel, tableHeader, dataValue } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import {
  STAFF_SCHEDULE_TIMEZONE,
  type StaffDayOfWeek,
  getCurrentStaffDayOfWeek,
  getStaffWeekdayLabel,
  isStaffBusinessDay,
} from '@/lib/staff-schedule';
import {
  useStaffScheduleData,
  buildWeekdayRuleMap,
  buildWeekScheduleDetailMap,
  getPlannedScheduleState,
  createAvailabilityDraft,
  DEFAULT_AVAILABILITY_DRAFT,
  type ScheduleMap,
  type PendingScheduleMap,
  type WeekdayRuleMap,
  type WeekScheduleDetailMap,
  type WeekdayRuleBucket,
  type AvailabilityRuleDraft,
  type AvailabilityEditorTarget,
  type StaffScheduleUpdatePayload,
  type StaffScheduleBulkPayload,
  type StaffWeekScheduleUpdatePayload,
  type StaffWeekCopyPayload,
} from '@/hooks/admin/useStaffScheduleData';

type StaffRole = 'technician' | 'packer';

function toNullableDateInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function StaffManagementTab() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('technician');
  const [newStaffEmployeeId, setNewStaffEmployeeId] = useState('');
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<StaffRole>('technician');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [savingScheduleKey, setSavingScheduleKey] = useState<string | null>(null);
  const [optimisticScheduleMap, setOptimisticScheduleMap] = useState<ScheduleMap>({});
  const [pendingScheduleMap, setPendingScheduleMap] = useState<PendingScheduleMap>({});
  const [calendarExpanded, setCalendarExpanded] = useState(true);
  const [availabilityEditor, setAvailabilityEditor] = useState<AvailabilityEditorTarget | null>(null);
  const [availabilityDraft, setAvailabilityDraft] = useState<AvailabilityRuleDraft>({ ...DEFAULT_AVAILABILITY_DRAFT });
  const pendingScheduleMapRef = useRef<PendingScheduleMap>({});
  const availabilitySectionRef = useRef<HTMLDivElement | null>(null);
  const staffChannelName = getStaffChannelName();

  // All queries + derived data from the extracted hook
  const {
    staff, scheduleResponse, availabilityRulesResponse,
    thisWeekDays, nextBusinessDays, allWeekDays,
    thisWeekStartDate, nextWeekStartDate,
    availabilityRuleMap, currentWeekDetailMap, nextWeekDetailMap,
  } = useStaffScheduleData();

  const createStaffMutation = useMutation({
    mutationFn: async (data: { name: string; role: StaffRole; employee_id: string; active: boolean }) => {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setIsAddingStaff(false);
      setNewStaffName('');
      setNewStaffEmployeeId('');
      setNewStaffRole('technician');
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      name?: string;
      role?: StaffRole;
      employee_id?: string;
      active?: boolean;
    }) => {
      const res = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setEditingStaffId(null);
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/staff?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      setEditingStaffId(null);
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
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
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
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
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
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
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Schedule updated');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update schedule');
    },
  });

  const upsertAvailabilityRuleMutation = useMutation({
    mutationFn: async (data: {
      id?: number;
      staffId: number;
      dayOfWeek: StaffDayOfWeek;
      isAllowed: boolean;
      reason?: string | null;
      effectiveStartDate?: string | null;
      effectiveEndDate?: string | null;
    }) => {
      const res = await fetch('/api/staff/availability-rules', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.id,
          staffId: data.staffId,
          ruleType: 'weekday_allowed',
          dayOfWeek: data.dayOfWeek,
          isAllowed: data.isAllowed,
          reason: data.reason ?? null,
          effectiveStartDate: data.effectiveStartDate ?? null,
          effectiveEndDate: data.effectiveEndDate ?? null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to save availability rule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-availability-rules'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Availability rule saved');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to save availability rule');
    },
  });

  const deleteAvailabilityRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/staff/availability-rules?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to delete availability rule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-availability-rules'] });
      queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Availability rule removed');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete availability rule');
    },
  });

  const startEditStaff = (member: Staff) => {
    setEditingStaffId(member.id);
    setEditName(member.name || '');
    setEditRole((member.role as StaffRole) || 'technician');
    setEditEmployeeId(member.employee_id || '');
    setEditActive(Boolean(member.active));
  };

  useEffect(() => {
    const handleOpenAdd = () => setIsAddingStaff(true);
    window.addEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
    return () => window.removeEventListener('admin-staff-open-add', handleOpenAdd as EventListener);
  }, []);

  useEffect(() => {
    pendingScheduleMapRef.current = pendingScheduleMap;
  }, [pendingScheduleMap]);

  useEffect(() => {
    return () => {
      Object.values(pendingScheduleMapRef.current).forEach((entry) => clearTimeout(entry.timerId));
    };
  }, []);

  useAblyChannel(staffChannelName, 'staff.schedule.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['staff-schedule'] });
    queryClient.invalidateQueries({ queryKey: ['staff'] });
  }, true);


  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const staffView = searchParams.get('staffView') || 'all';

  const filteredStaff = useMemo(() => {
    return staff.filter((member) => {
      const matchesSearch =
        !searchTerm ||
        member.name.toLowerCase().includes(searchTerm) ||
        (member.employee_id || '').toLowerCase().includes(searchTerm);

      const matchesView =
        staffView === 'active'
          ? Boolean(member.active)
          : staffView === 'inactive'
            ? !member.active
            : staffView === 'technician'
              ? member.role === 'technician'
              : staffView === 'packer'
                ? member.role === 'packer'
                : true;

      return matchesSearch && matchesView;
    });
  }, [searchTerm, staff, staffView]);

  const scheduleMap = useMemo<ScheduleMap>(() => {
    const map: ScheduleMap = {};

    for (const member of staff) {
      map[member.id] = {};
      for (const day of [...thisWeekDays, ...nextBusinessDays]) {
        map[member.id][day.date] = true;
      }
    }

    for (const row of scheduleResponse?.schedules || []) {
      if (!map[row.staff_id]) map[row.staff_id] = {};
      const dateKey = String(row.schedule_date || '');
      if (dateKey) map[row.staff_id][dateKey] = Boolean(row.is_scheduled);
    }

    return map;
  }, [nextBusinessDays, scheduleResponse?.schedules, staff, thisWeekDays]);

  const todayDay = Number.isFinite(Number(scheduleResponse?.today_day_of_week))
    ? Number(scheduleResponse?.today_day_of_week)
    : getCurrentStaffDayOfWeek();
  const isBusinessDayToday = isStaffBusinessDay(todayDay);
  const todayLabel = getStaffWeekdayLabel(todayDay);
  const timezoneLabel = scheduleResponse?.timezone || STAFF_SCHEDULE_TIMEZONE;
  const todayDateKey = getCurrentPSTDateKey();

  const getWeekdayRuleBucket = (staffId: number, dayOfWeek: StaffDayOfWeek): WeekdayRuleBucket => {
    return availabilityRuleMap[staffId]?.[dayOfWeek] || {
      primaryRule: null,
      extraRulesCount: 0,
      displayedIsAllowed: true,
    };
  };

  const getIsScheduled = (staffId: number, scheduleDate: string) => {
    const optimistic = optimisticScheduleMap[staffId]?.[scheduleDate];
    if (optimistic !== undefined) return optimistic;
    return scheduleMap[staffId]?.[scheduleDate] ?? true;
  };

  const getWeekDetail = (staffId: number, scheduleDate: string, weekScope: 'current' | 'next') => {
    return weekScope === 'current'
      ? currentWeekDetailMap[staffId]?.[scheduleDate]
      : nextWeekDetailMap[staffId]?.[scheduleDate];
  };

  const getScheduleCellMeta = (
    staffId: number,
    scheduleDate: string,
    dayOfWeek: StaffDayOfWeek,
    weekScope: 'current' | 'next'
  ) => {
    const detail = getWeekDetail(staffId, scheduleDate, weekScope);
    const isScheduled = getIsScheduled(staffId, scheduleDate);
    const blockedByRule = detail ? !detail.allowedByRule : !getWeekdayRuleBucket(staffId, dayOfWeek).displayedIsAllowed;
    const hasConflict = blockedByRule && getPlannedScheduleState(detail);
    return { detail, isScheduled, blockedByRule, hasConflict };
  };

  const selectedAvailabilityBucket = availabilityEditor
    ? getWeekdayRuleBucket(availabilityEditor.staffId, availabilityEditor.dayOfWeek)
    : null;
  const selectedAvailabilityRule = selectedAvailabilityBucket?.primaryRule || null;
  const selectedAvailabilityStaff = availabilityEditor
    ? staff.find((member) => member.id === availabilityEditor.staffId) || null
    : null;

  useEffect(() => {
    if (!availabilityEditor) return;
    setAvailabilityDraft(createAvailabilityDraft(selectedAvailabilityRule));
  }, [availabilityEditor, selectedAvailabilityRule]);

  const summary = useMemo(() => {
    return filteredStaff.reduce(
      (acc, member) => {
        acc.total += 1;
        if (member.active) acc.active += 1;
        else acc.inactive += 1;
        if (member.role === 'technician') acc.technicians += 1;
        if (member.role === 'packer') acc.packers += 1;
        if (isBusinessDayToday) {
          const isScheduledToday = getIsScheduled(member.id, todayDateKey);
          if (member.active && isScheduledToday) acc.presentToday += 1;
          else if (member.active) acc.offToday += 1;
        }
        return acc;
      },
      { total: 0, active: 0, inactive: 0, technicians: 0, packers: 0, presentToday: 0, offToday: 0 }
    );
  }, [filteredStaff, isBusinessDayToday, scheduleMap, todayDateKey]);

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

  const openAvailabilityEditorForDay = (staffId: number, dayOfWeek: StaffDayOfWeek) => {
    setAvailabilityEditor({ staffId, dayOfWeek });
    requestAnimationFrame(() => {
      availabilitySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleBlockedScheduleCell = (staffId: number, dayOfWeek: StaffDayOfWeek, scheduleDate: string) => {
    openAvailabilityEditorForDay(staffId, dayOfWeek);
    toast.message(`Blocked by availability rule for ${scheduleDate}`);
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

  const saveAvailabilityRule = (
    staffId: number,
    dayOfWeek: StaffDayOfWeek,
    draft: AvailabilityRuleDraft,
    existingRule: StaffAvailabilityRule | null,
    options?: { silentNoop?: boolean }
  ) => {
    const trimmedReason = draft.reason.trim();
    const effectiveStartDate = toNullableDateInput(draft.effectiveStartDate);
    const effectiveEndDate = toNullableDateInput(draft.effectiveEndDate);

    if (!existingRule && draft.isAllowed && !trimmedReason && !effectiveStartDate && !effectiveEndDate) {
      if (!options?.silentNoop) toast.message('Already allowed by default');
      return;
    }

    upsertAvailabilityRuleMutation.mutate({
      id: existingRule?.id,
      staffId,
      dayOfWeek,
      isAllowed: draft.isAllowed,
      reason: trimmedReason || null,
      effectiveStartDate,
      effectiveEndDate,
    });
  };

  const toggleAvailabilityAllowed = (staffId: number, dayOfWeek: StaffDayOfWeek, nextAllowed: boolean) => {
    const bucket = getWeekdayRuleBucket(staffId, dayOfWeek);
    saveAvailabilityRule(
      staffId,
      dayOfWeek,
      {
        isAllowed: nextAllowed,
        reason: bucket.primaryRule?.reason || '',
        effectiveStartDate: bucket.primaryRule?.effectiveStartDate || '',
        effectiveEndDate: bucket.primaryRule?.effectiveEndDate || '',
      },
      bucket.primaryRule,
      { silentNoop: true }
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

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className={`${sectionLabel} truncate text-gray-900`}>
            Staff Directory
          </p>
          <div className={`${sectionLabel} hidden items-center gap-3 sm:flex`}>
            <span>Shown {summary.total}</span>
            <span className="text-gray-500">/</span>
            <span>Scheduled Today {isBusinessDayToday ? summary.presentToday : 0}</span>
            <span className="text-gray-500">/</span>
            <span>{todayLabel}</span>
          </div>
        </div>
      </div>

      {isAddingStaff && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-5 border border-gray-200 bg-white"
        >
          <div className="grid gap-4 border-b border-gray-200 px-4 py-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Full Name</span>
              <input
                type="text"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
                placeholder="Enter full name"
              />
            </label>

            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Employee ID</span>
              <input
                type="text"
                value={newStaffEmployeeId}
                onChange={(e) => setNewStaffEmployeeId(e.target.value)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
                placeholder="Enter employee ID"
              />
            </label>

            <label className="space-y-1">
              <span className={`block ${sectionLabel}`}>Role</span>
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as StaffRole)}
                className="h-9 w-full border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-gray-400"
              >
                <option value="technician">Technician</option>
                <option value="packer">Packer</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsAddingStaff(false)}
              className={`${sectionLabel} h-9 border border-gray-300 px-4 text-gray-600 transition-colors hover:bg-gray-50`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                newStaffName.trim() &&
                createStaffMutation.mutate({
                  name: newStaffName.trim(),
                  role: newStaffRole,
                  employee_id: newStaffEmployeeId.trim(),
                  active: true,
                })
              }
              className={`${sectionLabel} h-9 border border-emerald-700 bg-emerald-700 px-4 text-white transition-colors hover:bg-emerald-800`}
            >
              Add Staff Member
            </button>
          </div>
        </motion.div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-2 sm:grid-cols-5">
          <SummaryCell label="Shown" value={summary.total} />
          <SummaryCell label="Active" value={summary.active} />
          <SummaryCell label="Technicians" value={summary.technicians} />
          <SummaryCell label="Packers" value={summary.packers} />
          <SummaryCell label="Scheduled Today" value={summary.presentToday} tone="emerald" />
        </div>

        <div ref={availabilitySectionRef} className="mb-6">
          <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
            <span>Availability Rules</span>
            <span>Permission to work by weekday</span>
          </div>

          {availabilityEditor && selectedAvailabilityStaff && (
            <div className="mb-3 border border-amber-200 bg-amber-50/60 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 pb-3">
                <div>
                  <p className={`${sectionLabel} text-amber-900`}>Editing Availability</p>
                  <p className={`${dataValue} mt-1 text-amber-950`}>
                    {selectedAvailabilityStaff.name} • {getStaffWeekdayLabel(availabilityEditor.dayOfWeek)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAvailabilityEditor(null)}
                  className={`${tableHeader} h-8 border border-amber-300 px-3 text-amber-800 hover:bg-amber-100`}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <label className="space-y-1">
                  <span className={`block ${sectionLabel}`}>State</span>
                  <select
                    value={availabilityDraft.isAllowed ? 'allowed' : 'blocked'}
                    onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, isAllowed: e.target.value === 'allowed' }))}
                    className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
                  >
                    <option value="allowed">Allowed</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={`block ${sectionLabel}`}>Start Date</span>
                  <input
                    type="date"
                    value={availabilityDraft.effectiveStartDate}
                    onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, effectiveStartDate: e.target.value }))}
                    className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className={`block ${sectionLabel}`}>End Date</span>
                  <input
                    type="date"
                    value={availabilityDraft.effectiveEndDate}
                    onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, effectiveEndDate: e.target.value }))}
                    className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
                  />
                </label>
                <label className="space-y-1 md:col-span-1">
                  <span className={`block ${sectionLabel}`}>Reason</span>
                  <input
                    type="text"
                    value={availabilityDraft.reason}
                    onChange={(e) => setAvailabilityDraft((prev) => ({ ...prev, reason: e.target.value }))}
                    className="h-9 w-full border border-amber-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-amber-400"
                    placeholder="Optional note"
                  />
                </label>
              </div>

              <div className={`${tableHeader} mt-3 flex flex-wrap items-center gap-3 text-amber-900`}>
                <span>
                  {selectedAvailabilityRule
                    ? 'Editing existing weekday rule'
                    : 'No explicit rule exists. Allowed state is inherited by default.'}
                </span>
                {selectedAvailabilityBucket?.extraRulesCount ? (
                  <span>{selectedAvailabilityBucket.extraRulesCount} additional windowed rule(s) exist for this weekday.</span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={upsertAvailabilityRuleMutation.isPending}
                  onClick={() => saveAvailabilityRule(availabilityEditor.staffId, availabilityEditor.dayOfWeek, availabilityDraft, selectedAvailabilityRule)}
                  className={`${sectionLabel} h-9 border border-amber-800 bg-amber-800 px-4 text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {selectedAvailabilityRule ? 'Save Rule' : 'Create Rule'}
                </button>
                {selectedAvailabilityRule && (
                  <button
                    type="button"
                    disabled={deleteAvailabilityRuleMutation.isPending}
                    onClick={() => deleteAvailabilityRuleMutation.mutate(selectedAvailabilityRule.id)}
                    className={`${sectionLabel} h-9 border border-red-300 bg-white px-4 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Delete Rule
                  </button>
                )}
                {!selectedAvailabilityRule && (
                  <button
                    type="button"
                    onClick={() => setAvailabilityDraft({ ...DEFAULT_AVAILABILITY_DRAFT })}
                    className={`${sectionLabel} h-9 border border-gray-300 bg-white px-4 text-gray-700 hover:bg-gray-50`}
                  >
                    Reset Draft
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto border border-gray-200 bg-white">
            <div className="min-w-[1240px]">
              <div className="grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(120px,1fr))] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                <span className={tableHeader}>Staff</span>
                {allWeekDays.map((day) => (
                  <span key={`availability-${day.dayOfWeek}`} className={`${tableHeader} text-center`}>
                    {day.label}
                  </span>
                ))}
              </div>

              {filteredStaff.map((member) => (
                <div
                  key={`availability-row-${member.id}`}
                  className={`grid grid-cols-[minmax(320px,1fr)_repeat(7,minmax(120px,1fr))] items-start border-b border-gray-100 px-4 py-3 ${
                    member.active ? 'bg-white' : 'bg-gray-50 text-gray-500'
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <p className={`${dataValue} truncate uppercase tracking-[0.02em]`}>
                      {member.name}
                    </p>
                    <div className={`${tableHeader} mt-0.5 flex items-center gap-2`}>
                      <span>{member.role}</span>
                      {member.employee_id ? <span>ID {member.employee_id}</span> : null}
                      <span>{member.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>

                  {allWeekDays.map((day) => {
                    const bucket = getWeekdayRuleBucket(member.id, day.dayOfWeek);
                    const isSelected = availabilityEditor?.staffId === member.id && availabilityEditor.dayOfWeek === day.dayOfWeek;
                    const titleParts = [
                      `${member.name} • ${day.label}`,
                      bucket.primaryRule ? `Rule #${bucket.primaryRule.id}` : 'Default allow',
                      bucket.extraRulesCount ? `+${bucket.extraRulesCount} extra windowed rule(s)` : '',
                    ].filter(Boolean);

                    return (
                      <div key={`availability-cell-${member.id}-${day.dayOfWeek}`} className="px-1 text-center">
                        <button
                          type="button"
                          disabled={!member.active || upsertAvailabilityRuleMutation.isPending}
                          onClick={() => toggleAvailabilityAllowed(member.id, day.dayOfWeek, !bucket.displayedIsAllowed)}
                          title={titleParts.join(' • ')}
                          className={[
                            `${tableHeader} h-8 w-full border transition-colors`,
                            bucket.displayedIsAllowed
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-red-200 bg-red-50 text-red-700',
                            isSelected ? 'ring-1 ring-amber-500' : '',
                            !member.active ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                          ].join(' ')}
                        >
                          {bucket.displayedIsAllowed ? 'Allowed' : 'Blocked'}
                        </button>
                        <button
                          type="button"
                          disabled={!member.active}
                          onClick={() => openAvailabilityEditorForDay(member.id, day.dayOfWeek)}
                          className={`${tableHeader} mt-1 text-[10px] ${member.active ? 'text-gray-600 hover:text-gray-900' : 'text-gray-400'}`}
                        >
                          Edit
                        </button>
                        {bucket.extraRulesCount > 0 && (
                          <div className="mt-1 text-[10px] font-bold text-amber-700">
                            +{bucket.extraRulesCount} window
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyBulkByRole('technician', true)}
            className={`${sectionLabel} h-8 border border-emerald-300 bg-emerald-50 px-3 text-emerald-700`}
          >
            All Tech Mon-Fri On
          </button>
          <button
            type="button"
            onClick={() => applyBulkByRole('technician', false)}
            className={`${sectionLabel} h-8 border border-gray-300 bg-white px-3 text-gray-700`}
          >
            All Tech Mon-Fri Off
          </button>
          <button
            type="button"
            onClick={() => applyBulkByRole('packer', true)}
            className={`${sectionLabel} h-8 border border-emerald-300 bg-emerald-50 px-3 text-emerald-700`}
          >
            All Packer Mon-Fri On
          </button>
          <button
            type="button"
            onClick={() => applyBulkByRole('packer', false)}
            className={`${sectionLabel} h-8 border border-gray-300 bg-white px-3 text-gray-700`}
          >
            All Packer Mon-Fri Off
          </button>
        </div>

        <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
          <span>Weekly Schedule</span>
          <span>{isBusinessDayToday ? todayLabel : `${todayLabel} (off day)`} • {timezoneLabel}</span>
        </div>

        <div className="overflow-x-auto border border-gray-200 bg-white">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(54px,1fr))_120px] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
              <span className={tableHeader}>Staff</span>
              {thisWeekDays.map((day) => (
                <span
                  key={`header-${day.date}`}
                  className={`${tableHeader} text-center ${
                    day.date === todayDateKey ? 'text-gray-900' : ''
                  }`}
                >
                  {day.label} {day.date.slice(5)}
                </span>
              ))}
              <span className={`${tableHeader} text-right`}>Actions</span>
            </div>

            {filteredStaff.map((member) => {
              if (editingStaffId === member.id) {
                return (
                  <div key={member.id} className="border-b border-gray-100 px-4 py-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                        placeholder="Full Name"
                      />
                      <input
                        type="text"
                        value={editEmployeeId}
                        onChange={(e) => setEditEmployeeId(e.target.value)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                        placeholder="Enter employee ID"
                      />
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as StaffRole)}
                        className="h-9 border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                      >
                        <option value="technician">Technician</option>
                        <option value="packer">Packer</option>
                      </select>
                    </div>

                    <label className={`${sectionLabel} mt-3 inline-flex items-center gap-2 text-gray-600`}>
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="h-4 w-4 border-gray-300 text-gray-900"
                      />
                      Active Staff Record
                    </label>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateStaffMutation.mutate({
                            id: member.id,
                            name: editName.trim(),
                            role: editRole,
                            employee_id: editEmployeeId.trim(),
                            active: editActive,
                          })
                        }
                        className={`${sectionLabel} h-9 border border-gray-900 bg-gray-900 px-4 text-white`}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingStaffId(null)}
                        className={`${sectionLabel} h-9 border border-gray-300 px-4 text-gray-700 hover:bg-gray-50`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteStaffMutation.mutate(member.id)}
                        className={`${sectionLabel} h-9 border border-red-300 px-4 text-red-700 hover:bg-red-50`}
                      >
                        Deactivate Staff
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={member.id}
                  className={`grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(54px,1fr))_120px] items-center border-b border-gray-100 px-4 py-2.5 ${
                    !member.active ? 'bg-gray-50 text-gray-500' : 'bg-white'
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <p className={`${dataValue} truncate uppercase tracking-[0.02em]`}>
                      {member.name}
                    </p>
                    <div className={`${tableHeader} mt-0.5 flex items-center gap-2`}>
                      <span>{member.role}</span>
                      {member.employee_id ? <span>ID {member.employee_id}</span> : null}
                      <span>{member.active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>

                  {thisWeekDays.map((day) => {
                    const { isScheduled, blockedByRule, hasConflict } = getScheduleCellMeta(member.id, day.date, day.dayOfWeek, 'current');
                    const isToday = day.date === todayDateKey;
                    const buttonKey = `${member.id}:${day.date}`;
                    const isDisabled = !member.active || savingScheduleKey === buttonKey;

                    return (
                      <button
                        key={`${member.id}-${day.date}`}
                        type="button"
                        onClick={() => {
                          if (blockedByRule) {
                            handleBlockedScheduleCell(member.id, day.dayOfWeek, day.date);
                            return;
                          }
                          toggleSchedule(member.id, day.dayOfWeek, day.date, Boolean(member.active));
                        }}
                        disabled={isDisabled}
                        className={[
                          `mx-1 h-8 border ${tableHeader} transition-colors`,
                          hasConflict
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : blockedByRule
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : isScheduled
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-gray-200 bg-gray-50 text-gray-500',
                          isToday ? 'outline outline-1 outline-gray-900/30' : '',
                          isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                        ].join(' ')}
                        aria-pressed={isScheduled}
                        aria-label={`${member.name} ${day.label} ${member.active ? (blockedByRule ? 'blocked' : isScheduled ? 'scheduled' : 'off') : 'inactive'}`}
                        title={`${member.name} • ${day.label} ${day.date}${blockedByRule ? ' • blocked by availability rule' : ''}`}
                      >
                        {hasConflict ? 'Conflict' : blockedByRule ? 'Blocked' : isScheduled ? 'On' : 'Off'}
                      </button>
                    );
                  })}

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => startEditStaff(member)}
                      className={`${tableHeader} h-8 border border-gray-300 px-3 text-gray-700 transition-colors hover:bg-gray-50`}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <div className={`${sectionLabel} mb-2 flex items-center justify-between`}>
            <span>Next Week (Mon-Fri)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!thisWeekStartDate || !nextWeekStartDate || copyWeekScheduleMutation.isPending}
                onClick={() =>
                  copyWeekScheduleMutation.mutate({
                    fromWeekStartDate: thisWeekStartDate,
                    toWeekStartDate: nextWeekStartDate,
                    mode: 'from_week',
                    includeInactive: false,
                  })
                }
                className={`${tableHeader} h-7 border border-gray-300 px-3 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Copy This Week
              </button>
              <button
                type="button"
                disabled={!thisWeekStartDate || !nextWeekStartDate || copyWeekScheduleMutation.isPending}
                onClick={() =>
                  copyWeekScheduleMutation.mutate({
                    fromWeekStartDate: thisWeekStartDate,
                    toWeekStartDate: nextWeekStartDate,
                    mode: 'template',
                    includeInactive: false,
                  })
                }
                className={`${tableHeader} h-7 border border-gray-300 px-3 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Reset to Template
              </button>
              <button
                type="button"
                onClick={() => setCalendarExpanded((v) => !v)}
                className={`${tableHeader} h-7 border border-gray-300 px-3 text-gray-700 hover:bg-gray-50`}
              >
                {calendarExpanded ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {calendarExpanded && (
            <div className="overflow-x-auto border border-gray-200 bg-white">
              <div className="min-w-[920px]">
                <div className="grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(90px,1fr))] items-center border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                  <span className={tableHeader}>Staff</span>
                  {nextBusinessDays.map((day) => (
                    <span key={`upcoming-${day.date}`} className={`${tableHeader} text-center`}>
                      {day.label} {day.date.slice(5)}
                    </span>
                  ))}
                </div>
                {filteredStaff.map((member) => (
                  <div
                    key={`upcoming-row-${member.id}`}
                    className={`grid grid-cols-[minmax(320px,1fr)_repeat(5,minmax(90px,1fr))] items-center border-b border-gray-100 px-4 py-2 ${
                      member.active ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    <p className={`${dataValue} truncate uppercase tracking-[0.02em] ${member.active ? 'text-gray-900' : 'text-gray-500'}`}>
                      {member.name}
                    </p>
                    {nextBusinessDays.map((day) => {
                      const { isScheduled, blockedByRule, hasConflict } = getScheduleCellMeta(member.id, day.date, day.dayOfWeek, 'next');
                      const buttonKey = `${member.id}:${day.date}`;
                      const isDisabled = !member.active || savingScheduleKey === buttonKey || updateWeekScheduleMutation.isPending;
                      return (
                        <button
                          type="button"
                          key={`upcoming-${member.id}-${day.date}`}
                          disabled={isDisabled}
                          onClick={() => {
                            if (blockedByRule) {
                              handleBlockedScheduleCell(member.id, day.dayOfWeek, day.date);
                              return;
                            }
                            toggleNextWeekSchedule(member.id, day.dayOfWeek, day.date, Boolean(member.active));
                          }}
                          className={[
                            `${tableHeader} mx-2 h-7 border text-center leading-7 transition-colors`,
                            !member.active
                              ? 'border-gray-200 bg-gray-100 text-gray-400'
                              : hasConflict
                                ? 'border-amber-300 bg-amber-50 text-amber-800'
                                : blockedByRule
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : isScheduled
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-gray-200 bg-gray-50 text-gray-500',
                            isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-gray-400',
                          ].join(' ')}
                          aria-pressed={isScheduled}
                          aria-label={`${member.name} next week ${day.label} ${member.active ? (blockedByRule ? 'blocked' : isScheduled ? 'scheduled' : 'off') : 'inactive'}`}
                          title={`${member.name} • ${day.label} ${day.date}${blockedByRule ? ' • blocked by availability rule' : ''}`}
                        >
                          {!member.active ? 'Inactive' : hasConflict ? 'Conflict' : blockedByRule ? 'Blocked' : isScheduled ? 'On' : 'Off'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {filteredStaff.length === 0 && (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <p className={sectionLabel}>No Staff Match</p>
            <p className="mt-2 text-[12px] font-bold text-gray-500">
              Change the sidebar filters or add a team member.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCell({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'emerald' }) {
  const valueClass = tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="border border-gray-200 bg-white px-3 py-2.5">
      <p className={sectionLabel}>{label}</p>
      <p className={`mt-1 text-xl font-black tracking-tight ${valueClass}`}>{value}</p>
    </div>
  );
}
