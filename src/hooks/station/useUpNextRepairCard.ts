'use client';

import { useState, useCallback, useMemo } from 'react';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { getDaysLateNumber } from '@/utils/upnext-helpers';
import { buildRepairWorkOrderRow } from '@/utils/upnext-helpers';
import { useWorkOrderAssignment } from './useWorkOrderAssignment';
import type { RepairQueueItem } from '@/components/station/upnext/upnext-types';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';

interface UseUpNextRepairCardOptions {
  repair: RepairQueueItem;
  techId: string;
  onRefresh?: () => void;
}

export function useUpNextRepairCard({ repair, techId, onRefresh }: UseUpNextRepairCardOptions) {
  const { getExternalUrlByItemNumber, openExternalByItemNumber } = useExternalItemUrl();
  const assignment = useWorkOrderAssignment();

  // Out-of-stock flow
  const [showOosInput, setShowOosInput] = useState(false);
  const [oosText, setOosText]           = useState('');
  const [oosSaving, setOosSaving]       = useState(false);

  // Repaired / repair-outcome flow
  const [showRepairedInput, setShowRepairedInput] = useState(false);
  const [outcomeText, setOutcomeText]             = useState('');
  const [repairedSaving, setRepairedSaving]       = useState(false);

  // Computed
  const skuValue      = String(repair.sku || '').trim();
  const ticketShort   = repair.ticketNumber ? repair.ticketNumber.slice(-4) : '????';
  const customerName  = repair.contactInfo ? repair.contactInfo.split(',')[0]?.trim() : '';
  const customerPhone = repair.contactInfo ? repair.contactInfo.split(',')[1]?.trim() : '';
  const daysLate      = getDaysLateNumber(repair.deadlineAt, repair.dateTime);
  const isUnassigned  = repair.assignedTechId === null;
  const hasOutOfStock = !!repair.outOfStock;
  const hasOutcome    = !!repair.repairOutcome;
  const displayDate   = repair.deadlineAt || repair.dateTime || null;
  const workOrderRow  = useMemo(() => buildRepairWorkOrderRow(repair), [repair]);

  // Override handleAssignConfirm to include onRefresh callback
  const handleAssignConfirm = useCallback(async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const newStatus =
      payload.status ??
      (payload.techId && payload.packerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
    try {
      const res = await fetch('/api/work-orders', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType:       row.entityType,
          entityId:         row.entityId,
          assignedTechId:   payload.techId,
          assignedPackerId: payload.packerId,
          status:           newStatus,
          priority:         row.priority,
          deadlineAt:       payload.deadline,
          notes:            row.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.details || data?.error || 'Failed to save');
      }
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save assignment');
    }
  }, [onRefresh]);

  const handleOosSubmit = useCallback(async () => {
    if (!oosText.trim()) return;
    setOosSaving(true);
    try {
      const res = await fetch('/api/repair-service/out-of-stock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId:     repair.repairId,
          assignmentId: repair.assignmentId,
          part:         oosText.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setShowOosInput(false);
      setOosText('');
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save out of stock');
    } finally {
      setOosSaving(false);
    }
  }, [oosText, repair.repairId, repair.assignmentId, onRefresh]);

  const handleRepairedSubmit = useCallback(async () => {
    if (!outcomeText.trim()) return;
    setRepairedSaving(true);
    try {
      const numericTechId = Number(techId);
      const resolvedTechId = Number.isFinite(numericTechId) && numericTechId > 0
        ? numericTechId
        : repair.assignedTechId;

      const res = await fetch('/api/repair-service/repaired', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId:          repair.repairId,
          assignmentId:      repair.assignmentId,
          repairedPart:      outcomeText.trim(),
          completedByTechId: resolvedTechId,
          assignedTechId:    repair.assignedTechId ?? resolvedTechId ?? null,
        }),
      });
      if (!res.ok) throw new Error('Failed to mark repaired');
      setShowRepairedInput(false);
      setOutcomeText('');
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
      onRefresh?.();
    } catch (err: any) {
      window.alert(err?.message || 'Failed to mark repair as repaired');
    } finally {
      setRepairedSaving(false);
    }
  }, [outcomeText, techId, repair.repairId, repair.assignmentId, repair.assignedTechId, onRefresh]);

  return {
    // Computed
    skuValue,
    ticketShort,
    customerName,
    customerPhone,
    daysLate,
    isUnassigned,
    hasOutOfStock,
    hasOutcome,
    displayDate,
    workOrderRow,

    // External URL
    getExternalUrlByItemNumber,
    openExternalByItemNumber,

    // OOS flow
    showOosInput,
    setShowOosInput,
    oosText,
    setOosText,
    oosSaving,
    handleOosSubmit,

    // Repaired flow
    showRepairedInput,
    setShowRepairedInput,
    outcomeText,
    setOutcomeText,
    repairedSaving,
    handleRepairedSubmit,

    // Assignment (from sub-hook, but with overridden confirm)
    showAssignment: assignment.showAssignment,
    setShowAssignment: assignment.setShowAssignment,
    technicianOptions: assignment.technicianOptions,
    packerOptions: assignment.packerOptions,
    mounted: assignment.mounted,
    openAssignment: assignment.openAssignment,
    handleAssignConfirm,
  };
}
