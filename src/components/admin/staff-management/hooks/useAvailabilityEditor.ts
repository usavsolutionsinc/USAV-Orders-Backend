import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { toast } from '@/lib/toast';
import type { StaffDayOfWeek } from '@/lib/staff-schedule';
import {
  createAvailabilityDraft,
  DEFAULT_AVAILABILITY_DRAFT,
  type AvailabilityRuleDraft,
  type AvailabilityEditorTarget,
  type WeekdayRuleBucket,
} from '@/hooks/admin/useStaffScheduleData';
import type { Staff, StaffAvailabilityRule } from '../../types';
import { toNullableDateInput } from '../constants';

interface UseAvailabilityEditorArgs {
  staff: Staff[];
  getWeekdayRuleBucket: (staffId: number, dayOfWeek: StaffDayOfWeek) => WeekdayRuleBucket;
}

/**
 * Owns the per-weekday availability-rule editor: which cell is open, the draft
 * being edited, the derived "selected rule" view, and the upsert / delete
 * mutations that persist weekday allow/block rules.
 */
export function useAvailabilityEditor({ staff, getWeekdayRuleBucket }: UseAvailabilityEditorArgs) {
  const queryClient = useQueryClient();
  const [availabilityEditor, setAvailabilityEditor] = useState<AvailabilityEditorTarget | null>(null);
  const [availabilityDraft, setAvailabilityDraft] = useState<AvailabilityRuleDraft>({ ...DEFAULT_AVAILABILITY_DRAFT });
  const availabilitySectionRef = useRef<HTMLDivElement | null>(null);

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
      queryClient.invalidateQueries({ queryKey: qk.staffAvailabilityRules });
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
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
      queryClient.invalidateQueries({ queryKey: qk.staffAvailabilityRules });
      queryClient.invalidateQueries({ queryKey: qk.staffSchedule.all });
      queryClient.invalidateQueries({ queryKey: qk.staff.all });
      toast.success('Availability rule removed');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete availability rule');
    },
  });

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

  const openAvailabilityEditorForDay = (staffId: number, dayOfWeek: StaffDayOfWeek) => {
    setAvailabilityEditor({ staffId, dayOfWeek });
    requestAnimationFrame(() => {
      availabilitySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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

  return {
    availabilityEditor,
    setAvailabilityEditor,
    availabilityDraft,
    setAvailabilityDraft,
    availabilitySectionRef,
    selectedAvailabilityBucket,
    selectedAvailabilityRule,
    selectedAvailabilityStaff,
    openAvailabilityEditorForDay,
    saveAvailabilityRule,
    toggleAvailabilityAllowed,
    upsertAvailabilityRuleMutation,
    deleteAvailabilityRuleMutation,
  };
}
