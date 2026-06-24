'use client';

import { useCallback, useEffect, useState } from 'react';
import { emitAppEvent } from '@/hooks';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';
import { useDeleteOrderRow } from '@/hooks';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';
import { staffHasRole } from '@/utils/staff';
import { getPresentStaffForToday, type StaffMember } from '@/lib/staffCache';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { ShippedActiveSection } from '@/components/shipped/ShippedDetailsPanelContent';
import type { ShippedActiveInput } from '@/components/shipped/stacks/types';
import { resolveDeleteRequest, toMonthDayYearCurrent } from '@/components/shipped/details-panel/shipped-details-logic';

// Re-exported so consumers of WorkOrderAssignmentCard's confirm payload can find it here.
export type { AssignmentConfirmPayload };

/**
 * Owns the panel's working copy of the order plus the inline-editable shipping
 * fields (order #, item #, tracking, ship-by date). Resyncs everything whenever
 * the underlying order changes (e.g. up/down navigation), and exposes the save
 * actions backed by {@link useOrderFieldSave}.
 */
export function useShippedDetailState(initialShipped: ShippedOrder, onUpdate: () => void) {
  const [shipped, setShipped] = useState<ShippedOrder>(initialShipped);
  const [shipByDate, setShipByDate] = useState('');
  const [orderNumber, setOrderNumber] = useState(initialShipped.order_id || '');
  const [itemNumber, setItemNumber] = useState(initialShipped.item_number || '');
  const [shippingTrackingNumber, setShippingTrackingNumber] = useState(initialShipped.shipping_tracking_number || '');
  const [notes, setNotes] = useState(initialShipped.notes || '');

  const fieldSave = useOrderFieldSave({
    orderId: shipped.id,
    initialOrderNumber: initialShipped.order_id || '',
    initialItemNumber: initialShipped.item_number || '',
    initialTrackingNumber: initialShipped.shipping_tracking_number || '',
    onUpdate,
  });
  const {
    isSavingInlineFields,
    isSavingNotes,
    isSavingShipByDate,
    saveInlineFields: persistInlineFields,
    saveNotes,
    saveShipByDate,
    resetRefs,
  } = fieldSave;

  useEffect(() => {
    setShipped(initialShipped);
    const preferredDate = String(initialShipped.ship_by_date || '').trim() || initialShipped.created_at || '';
    setShipByDate(toMonthDayYearCurrent(preferredDate));
    setOrderNumber(initialShipped.order_id || '');
    setItemNumber(initialShipped.item_number || '');
    setShippingTrackingNumber(initialShipped.shipping_tracking_number || '');
    setNotes(initialShipped.notes || '');
    resetRefs(
      initialShipped.order_id || '',
      initialShipped.item_number || '',
      initialShipped.shipping_tracking_number || '',
    );
  }, [initialShipped, resetRefs]);

  const saveInlineFields = useCallback(async () => {
    await persistInlineFields(orderNumber, itemNumber, shippingTrackingNumber);
  }, [itemNumber, orderNumber, persistInlineFields, shippingTrackingNumber]);

  return {
    shipped,
    setShipped,
    orderNumber,
    setOrderNumber,
    itemNumber,
    setItemNumber,
    shippingTrackingNumber,
    setShippingTrackingNumber,
    notes,
    setNotes,
    shipByDate,
    setShipByDate,
    isSavingInlineFields,
    isSavingNotes,
    isSavingShipByDate,
    saveInlineFields,
    saveNotes,
    saveShipByDate,
  };
}

export interface UseShippedPanelViewStateOptions {
  initialShipped: ShippedOrder;
  hasReturnContent: boolean;
}

/**
 * The panel's view state — the active tab plus the lifted inline-editor toggles
 * (out-of-stock / notes input, mark-as-shipped). Resets to sensible defaults
 * when the underlying order changes.
 */
export function useShippedPanelViewState({ initialShipped, hasReturnContent }: UseShippedPanelViewStateOptions) {
  const [activeSection, setActiveSection] = useState<ShippedActiveSection>(
    hasReturnContent ? 'return' : 'shipping',
  );
  const [activeInput, setActiveInput] = useState<ShippedActiveInput>('none');
  const [isMarkAsShippedOpen, setIsMarkAsShippedOpen] = useState(false);

  // Reset to a sensible default when the underlying order changes (e.g. user
  // navigates to a different order via the panel's up/down arrows).
  useEffect(() => {
    setActiveSection(hasReturnContent ? 'return' : 'shipping');
  }, [initialShipped.id, hasReturnContent]);

  useEffect(() => {
    setActiveInput('none');
    setIsMarkAsShippedOpen(false);
  }, [initialShipped.id]);

  return {
    activeSection,
    setActiveSection,
    activeInput,
    setActiveInput,
    isMarkAsShippedOpen,
    setIsMarkAsShippedOpen,
  };
}

/**
 * Two-step (arm → confirm) permanent delete for a shipped row. The first call
 * arms for 3s; the second performs the resolved delete (exception / packing
 * log / order) and calls `onUpdate`.
 */
export function useShippedDeletion(shipped: ShippedOrder, onUpdate: () => void) {
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteOrderMutation = useDeleteOrderRow();

  const handleDelete = useCallback(async () => {
    const request = resolveDeleteRequest(shipped);
    if (!request) return;

    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      window.setTimeout(() => setIsDeleteArmed(false), 3000);
      return;
    }

    setIsDeleteArmed(false);
    try {
      await deleteOrderMutation.mutateAsync(request);
      onUpdate();
    } catch (error) {
      console.error('Failed to delete shipped order:', error);
      window.alert('Failed to permanently delete order. Please try again.');
    }
  }, [shipped, isDeleteArmed, deleteOrderMutation, onUpdate]);

  return { isDeleteArmed, isDeleting: deleteOrderMutation.isPending, handleDelete };
}

export interface UseShippedAssignmentOptions {
  shipped: ShippedOrder;
  setShipped: React.Dispatch<React.SetStateAction<ShippedOrder>>;
  onUpdate: () => void;
}

/**
 * Work-order assignment: loads today's present staff on demand, derives the
 * technician / packer option lists, and persists tech/packer/deadline changes
 * (optimistically updating the local order and firing refresh events).
 */
export function useShippedAssignment({ shipped: _shipped, setShipped, onUpdate }: UseShippedAssignmentOptions) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [showAssignmentCard, setShowAssignmentCard] = useState(false);

  const technicianOptions = staff
    .filter((member) => staffHasRole(member, 'technician'))
    .map((member) => ({ id: Number(member.id), name: member.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const packerOptions = staff
    .filter((member) => staffHasRole(member, 'packer'))
    .map((member) => ({ id: Number(member.id), name: member.name }));

  const openAssignmentCard = useCallback(async () => {
    try {
      const members = await getPresentStaffForToday();
      setStaff(members);
      setShowAssignmentCard(true);
    } catch {
      window.alert('Failed to load staff.');
    }
  }, []);

  const handleAssignmentConfirm = useCallback(
    async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
      const nextStatus = payload.status ?? (payload.techId && payload.packerId ? 'ASSIGNED' : 'OPEN');

      try {
        const res = await fetch('/api/work-orders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType: row.entityType,
            entityId: row.entityId,
            assignedTechId: payload.techId,
            assignedPackerId: payload.packerId,
            status: nextStatus,
            priority: row.priority,
            deadlineAt: payload.deadline,
            notes: row.notes,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.details || data?.error || 'Failed to save assignment');
        }

        setShipped((current) => ({
          ...current,
          tester_id: payload.techId,
          packer_id: payload.packerId,
          ship_by_date: payload.deadline ?? current.ship_by_date,
          deadline_at: payload.deadline ?? current.deadline_at,
        }));
        emitAppEvent('dashboard-refresh');
        emitAppEvent('usav-refresh-data');
        onUpdate();
      } catch (error: any) {
        window.alert(error?.message || 'Failed to save assignment');
      }
    },
    [onUpdate, setShipped],
  );

  return {
    staff,
    showAssignmentCard,
    setShowAssignmentCard,
    openAssignmentCard,
    handleAssignmentConfirm,
    technicianOptions,
    packerOptions,
  };
}

/** Transient "copied ✓" feedback for the copy-all and copy-order-id actions. */
export function useShippedCopyActions(shipped: ShippedOrder, orderIdDisplay: string) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState(false);

  const handleCopyAll = useCallback(() => {
    const allInfo = buildShippedCopyInfo(shipped);
    navigator.clipboard.writeText(allInfo);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }, [shipped]);

  const handleCopyOrderId = useCallback(() => {
    const value = orderIdDisplay.trim();
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedOrderId(true);
    setTimeout(() => setCopiedOrderId(false), 1500);
  }, [orderIdDisplay]);

  return { copiedAll, copiedOrderId, handleCopyAll, handleCopyOrderId };
}

// Re-export so the panel composition can render the card without a separate import.
export { WorkOrderAssignmentCard };
