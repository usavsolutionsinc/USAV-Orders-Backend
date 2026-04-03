'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { saveWorkOrder } from '@/lib/work-orders/saveWorkOrder';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { StaffOption } from '@/components/station/upnext/upnext-types';


export interface UseWorkOrderAssignmentReturn {
  showAssignment: boolean;
  setShowAssignment: (v: boolean) => void;
  technicianOptions: StaffOption[];
  packerOptions: StaffOption[];
  mounted: boolean;
  openAssignment: (e: React.MouseEvent) => void;
  handleAssignConfirm: (row: WorkOrderRow, payload: AssignmentConfirmPayload) => Promise<void>;
}

export function useWorkOrderAssignment(): UseWorkOrderAssignmentReturn {
  const [showAssignment, setShowAssignment]       = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions]         = useState<StaffOption[]>([]);
  const [mounted, setMounted]                     = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const openAssignment = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const members = await getPresentStaffForToday();
      setTechnicianOptions(
        members
          .filter((m) => m.role === 'technician')
          .map((m) => ({ id: Number(m.id), name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setPackerOptions(
        members
          .filter((m) => m.role === 'packer')
          .map((m) => ({ id: Number(m.id), name: m.name })),
      );
    } catch { /* proceed with empty lists */ }
    setShowAssignment(true);
  }, []);

  const handleAssignConfirm = useCallback(async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const newStatus =
      payload.status ??
      (payload.techId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
    try {
      await saveWorkOrder({
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: payload.techId,
        assignedPackerId: payload.packerId,
        status: newStatus,
        priority: row.priority,
        deadlineAt: payload.deadline,
        notes: row.notes,
      });
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: any) {
      window.alert(err?.message || 'Failed to save assignment');
    }
  }, []);

  return {
    showAssignment,
    setShowAssignment,
    technicianOptions,
    packerOptions,
    mounted,
    openAssignment,
    handleAssignConfirm,
  };
}
