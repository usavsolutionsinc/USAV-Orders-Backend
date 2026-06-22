'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Popover } from '@/design-system/primitives/Popover';
import { StaffButtonGrid, type StaffOption } from '@/components/shipping/StaffButtonGrid';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { staffHasRole } from '@/utils/staff';
import { saveWorkOrder } from '@/lib/work-orders/saveWorkOrder';
import type { WorkOrderRow } from '@/components/work-orders/types';

/**
 * WorkOrderAssignPopover — P1-WORK-01 acceptance A.
 *
 * A lightweight POPOVER variant of work-order assignment (the existing
 * WorkOrderAssignmentCard is a full-screen takeover overlay). Built on the
 * P0-DS-01 Popover primitive + the existing StaffButtonGrid picker, and it
 * persists through the SAME endpoint via saveWorkOrder() (PATCH /api/work-orders)
 * — so this is purely an additive, alternate trigger surface, not a new model.
 *
 * Use it anywhere a row already has an anchor button (table rows, detail panels)
 * and a takeover modal would be too heavy. Assigns/reassigns the tester slot for
 * any entity; for ORDER it also exposes the packer slot (matching the endpoint's
 * TEST/PACK work-assignment split).
 */

interface WorkOrderAssignPopoverProps {
  row: WorkOrderRow;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Fired after a successful save so the caller can refresh its data. */
  onAssigned?: (next: { techId: number | null; packerId: number | null }) => void;
}

export function WorkOrderAssignPopover({
  row,
  open,
  onClose,
  anchorRef,
  onAssigned,
}: WorkOrderAssignPopoverProps) {
  const [technicianOptions, setTechnicianOptions] = useState<StaffOption[]>([]);
  const [packerOptions, setPackerOptions] = useState<StaffOption[]>([]);
  const [techId, setTechId] = useState<number | null>(row.techId);
  const [packerId, setPackerId] = useState<number | null>(row.packerId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const supportsPacker = row.entityType === 'ORDER';

  // Sync the local draft with the row whenever the popover (re)opens.
  useEffect(() => {
    if (!open) return;
    setTechId(row.techId);
    setPackerId(row.packerId);
    setError(null);
  }, [open, row.techId, row.packerId]);

  // Lazy-load present staff the first time the popover opens.
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    getPresentStaffForToday()
      .then((members) => {
        setTechnicianOptions(
          members
            .filter((m) => staffHasRole(m, 'technician'))
            .map((m) => ({ id: Number(m.id), name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setPackerOptions(
          members
            .filter((m) => staffHasRole(m, 'packer'))
            .map((m) => ({ id: Number(m.id), name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {
        /* proceed with empty lists */
      });
  }, [open]);

  const persist = useCallback(
    async (nextTechId: number | null, nextPackerId: number | null) => {
      setSaving(true);
      setError(null);
      // Promote OPEN → ASSIGNED when a tester is set, mirroring the modal hook.
      const nextStatus =
        nextTechId != null && row.status === 'OPEN' ? 'ASSIGNED' : row.status;
      try {
        await saveWorkOrder({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: nextTechId,
          // Only thread the packer slot for ORDER entities (the endpoint owns
          // the TEST/PACK split). Omitting the key on non-orders avoids touching
          // a PACK assignment that doesn't apply.
          ...(supportsPacker ? { assignedPackerId: nextPackerId } : {}),
          status: nextStatus,
          priority: row.priority,
          deadlineAt: row.deadlineAt,
          notes: row.notes,
        });
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        onAssigned?.({ techId: nextTechId, packerId: nextPackerId });
      } catch (err: any) {
        setError(err?.message || 'Failed to save assignment');
      } finally {
        setSaving(false);
      }
    },
    [row, supportsPacker, onAssigned],
  );

  const selectTech = useCallback(
    (id: number) => {
      // Tapping the active tester clears the assignment (toggle).
      const next = techId === id ? null : id;
      setTechId(next);
      void persist(next, packerId);
    },
    [techId, packerId, persist],
  );

  const selectPacker = useCallback(
    (id: number) => {
      const next = packerId === id ? null : id;
      setPackerId(next);
      void persist(techId, next);
    },
    [techId, packerId, persist],
  );

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-start"
      role="dialog"
      aria-label="Assign work order"
      className="w-[280px]"
    >
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            Assign · {row.queueLabel}
          </p>
          <p className="mt-0.5 truncate text-[12px] font-semibold text-gray-800">{row.title}</p>
        </div>

        <StaffButtonGrid
          label={supportsPacker ? 'Tester' : 'Assignee'}
          options={technicianOptions}
          selectedId={techId}
          onSelect={selectTech}
          columns={2}
          emptyMessage="No staff present today"
        />

        {supportsPacker ? (
          <StaffButtonGrid
            label="Packer"
            options={packerOptions}
            selectedId={packerId}
            onSelect={selectPacker}
            columns={2}
            emptyMessage="No packers present today"
          />
        ) : null}

        {error ? <p className="text-[11px] font-medium text-red-600">{error}</p> : null}
        {saving ? <p className="text-[10px] text-gray-400">Saving…</p> : null}
      </div>
    </Popover>
  );
}
