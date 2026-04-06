import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Staff, StaffAvailabilityRule } from '@/components/admin/types';
import { getCurrentBusinessWeekDays, getNextBusinessDays } from '@/lib/staff-availability';
import {
  STAFF_WEEKDAY_LABELS,
  type StaffDayOfWeek,
} from '@/lib/staff-schedule';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StaffScheduleRow {
  staff_id: number;
  day_of_week: number;
  is_scheduled: boolean;
  schedule_date?: string;
}

export interface StaffScheduleResponse {
  timezone: string;
  today_day_of_week: number;
  schedules: StaffScheduleRow[];
}

export interface StaffWeekScheduleRow {
  staffId: number;
  name: string;
  role: string;
  active: boolean;
  dayOfWeek: number;
  scheduleDate: string;
  templateIsScheduled: boolean | null;
  planIsScheduled: boolean | null;
  overrideIsScheduled: boolean | null;
  allowedByRule: boolean;
  effectiveIsScheduled: boolean;
}

export interface StaffWeekScheduleResponse {
  weekStartDate: string;
  rows: StaffWeekScheduleRow[];
}

export interface StaffAvailabilityRulesResponse {
  rules: StaffAvailabilityRule[];
}

export interface WeekdayRuleBucket {
  primaryRule: StaffAvailabilityRule | null;
  extraRulesCount: number;
  displayedIsAllowed: boolean;
}

export type ScheduleMap = Record<number, Record<string, boolean>>;
export type PendingScheduleMap = Record<string, { staffId: number; dayOfWeek: StaffDayOfWeek; scheduleDate: string; previous: boolean; next: boolean; timerId: ReturnType<typeof setTimeout> }>;
export type WeekdayRuleMap = Record<number, Partial<Record<StaffDayOfWeek, WeekdayRuleBucket>>>;
export type WeekScheduleDetailMap = Record<number, Record<string, StaffWeekScheduleRow>>;

export interface StaffScheduleUpdatePayload {
  staffId: number;
  dayOfWeek?: number;
  scheduleDate?: string;
  isScheduled: boolean;
}

export interface StaffScheduleBulkPayload {
  updates: StaffScheduleUpdatePayload[];
}

export interface StaffWeekScheduleUpdatePayload {
  staffId: number;
  weekStartDate: string;
  dayOfWeek: number;
  isScheduled: boolean;
}

export interface StaffWeekCopyPayload {
  fromWeekStartDate: string;
  toWeekStartDate: string;
  mode: 'template' | 'from_week';
  includeInactive?: boolean;
}

export interface AvailabilityEditorTarget {
  staffId: number;
  dayOfWeek: StaffDayOfWeek;
}

// ─── Helper functions ───────────────────────────────────────────────────────

function getPrimaryWeekdayRule(rules: StaffAvailabilityRule[]): StaffAvailabilityRule | null {
  if (!rules.length) return null;
  const sorted = [...rules].sort((a, b) => {
    const aWindowed = a.effectiveStartDate != null || a.effectiveEndDate != null;
    const bWindowed = b.effectiveStartDate != null || b.effectiveEndDate != null;
    if (aWindowed !== bWindowed) return aWindowed ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id - b.id;
  });
  return sorted[0] || null;
}

export function buildWeekdayRuleMap(rules: StaffAvailabilityRule[]): WeekdayRuleMap {
  const grouped: Record<number, Partial<Record<StaffDayOfWeek, StaffAvailabilityRule[]>>> = {};
  for (const rule of rules) {
    if (rule.ruleType !== 'weekday_allowed' || rule.dayOfWeek == null) continue;
    const dayOfWeek = rule.dayOfWeek as StaffDayOfWeek;
    if (!grouped[rule.staffId]) grouped[rule.staffId] = {};
    if (!grouped[rule.staffId][dayOfWeek]) grouped[rule.staffId][dayOfWeek] = [];
    grouped[rule.staffId][dayOfWeek]!.push(rule);
  }
  const result: WeekdayRuleMap = {};
  for (const [staffIdRaw, dayMap] of Object.entries(grouped)) {
    const staffId = Number(staffIdRaw);
    result[staffId] = {};
    for (const [dayOfWeekRaw, dayRules] of Object.entries(dayMap)) {
      const dayOfWeek = Number(dayOfWeekRaw) as StaffDayOfWeek;
      const primaryRule = getPrimaryWeekdayRule(dayRules || []);
      result[staffId][dayOfWeek] = {
        primaryRule,
        extraRulesCount: Math.max(0, (dayRules?.length || 0) - (primaryRule ? 1 : 0)),
        displayedIsAllowed: primaryRule ? Boolean(primaryRule.isAllowed) : true,
      };
    }
  }
  return result;
}

export function buildWeekScheduleDetailMap(rows: StaffWeekScheduleRow[]): WeekScheduleDetailMap {
  const map: WeekScheduleDetailMap = {};
  for (const row of rows) {
    if (!map[row.staffId]) map[row.staffId] = {};
    map[row.staffId][row.scheduleDate] = row;
  }
  return map;
}

export function getPlannedScheduleState(row: StaffWeekScheduleRow | null | undefined): boolean {
  if (!row) return true;
  if (row.overrideIsScheduled != null) return row.overrideIsScheduled;
  if (row.planIsScheduled != null) return row.planIsScheduled;
  if (row.templateIsScheduled != null) return row.templateIsScheduled;
  return true;
}

export interface AvailabilityRuleDraft {
  isAllowed: boolean;
  reason: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
}

export const DEFAULT_AVAILABILITY_DRAFT: AvailabilityRuleDraft = {
  isAllowed: true,
  reason: '',
  effectiveStartDate: '',
  effectiveEndDate: '',
};

export function createAvailabilityDraft(rule: StaffAvailabilityRule | null): AvailabilityRuleDraft {
  if (!rule) return { ...DEFAULT_AVAILABILITY_DRAFT };
  return {
    isAllowed: Boolean(rule.isAllowed),
    reason: rule.reason || '',
    effectiveStartDate: rule.effectiveStartDate || '',
    effectiveEndDate: rule.effectiveEndDate || '',
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useStaffScheduleData() {
  const thisWeekDays = useMemo(() => getCurrentBusinessWeekDays(), []);
  const nextBusinessDays = useMemo(() => getNextBusinessDays(5), []);
  const allWeekDays = useMemo(
    () => STAFF_WEEKDAY_LABELS.map((label, index) => ({ label, dayOfWeek: index as StaffDayOfWeek })),
    []
  );
  const thisWeekStartDate = thisWeekDays[0]?.date || '';
  const nextWeekStartDate = nextBusinessDays[0]?.date || '';

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=false');
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    },
  });

  const { data: scheduleResponse } = useQuery<StaffScheduleResponse>({
    queryKey: ['staff-schedule', 'range', thisWeekStartDate, nextBusinessDays[nextBusinessDays.length - 1]?.date || ''],
    enabled: Boolean(thisWeekStartDate && nextBusinessDays[nextBusinessDays.length - 1]?.date),
    queryFn: async () => {
      const startDate = thisWeekStartDate;
      const endDate = nextBusinessDays[nextBusinessDays.length - 1]?.date;
      const res = await fetch(`/api/staff/schedule?includeInactive=true&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate || '')}`);
      if (!res.ok) throw new Error('Failed to fetch staff schedule');
      return res.json();
    },
  });

  const { data: currentWeekResponse } = useQuery<StaffWeekScheduleResponse>({
    queryKey: ['staff-schedule', 'week', thisWeekStartDate],
    enabled: Boolean(thisWeekStartDate),
    queryFn: async () => {
      const res = await fetch(`/api/staff/schedule/week?weekStart=${encodeURIComponent(thisWeekStartDate)}&includeInactive=true`);
      if (!res.ok) throw new Error('Failed to fetch current week schedule details');
      return res.json();
    },
  });

  const { data: nextWeekResponse } = useQuery<StaffWeekScheduleResponse>({
    queryKey: ['staff-schedule', 'week', nextWeekStartDate],
    enabled: Boolean(nextWeekStartDate),
    queryFn: async () => {
      const res = await fetch(`/api/staff/schedule/week?weekStart=${encodeURIComponent(nextWeekStartDate)}&includeInactive=true`);
      if (!res.ok) throw new Error('Failed to fetch next week schedule details');
      return res.json();
    },
  });

  const { data: availabilityRulesResponse } = useQuery<StaffAvailabilityRulesResponse>({
    queryKey: ['staff-availability-rules'],
    queryFn: async () => {
      const res = await fetch('/api/staff/availability-rules');
      if (!res.ok) throw new Error('Failed to fetch availability rules');
      return res.json();
    },
  });

  // Derived data
  const availabilityRuleMap = useMemo(
    () => buildWeekdayRuleMap(availabilityRulesResponse?.rules || []),
    [availabilityRulesResponse?.rules]
  );

  const currentWeekDetailMap = useMemo(
    () => buildWeekScheduleDetailMap(currentWeekResponse?.rows || []),
    [currentWeekResponse?.rows]
  );

  const nextWeekDetailMap = useMemo(
    () => buildWeekScheduleDetailMap(nextWeekResponse?.rows || []),
    [nextWeekResponse?.rows]
  );

  return {
    staff,
    scheduleResponse,
    currentWeekResponse,
    nextWeekResponse,
    availabilityRulesResponse,
    thisWeekDays,
    nextBusinessDays,
    allWeekDays,
    thisWeekStartDate,
    nextWeekStartDate,
    availabilityRuleMap,
    currentWeekDetailMap,
    nextWeekDetailMap,
  };
}
