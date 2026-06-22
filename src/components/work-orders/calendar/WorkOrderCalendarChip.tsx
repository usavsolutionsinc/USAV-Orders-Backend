'use client';

import { useRef, useState } from 'react';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { STATUS_COLOR } from '@/components/work-orders/types';
import { WorkOrderAssignPopover } from '@/components/work-orders/WorkOrderAssignPopover';

/**
 * A single assignment placed on a calendar day. Renders a compact chip showing
 * the record + assignee; clicking it opens the shared WorkOrderAssignPopover so
 * the user can view/assign/reassign — persisting through the SAME PATCH
 * /api/work-orders endpoint (acceptance B). No new write path is introduced.
 */
export function WorkOrderCalendarChip({
  row,
  onAssigned,
}: {
  row: WorkOrderRow;
  onAssigned?: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const assignee = row.techName || row.packerName || 'Unassigned';
  const tone = STATUS_COLOR[row.status] ?? 'text-slate-600 bg-slate-100';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold leading-tight transition-colors hover:brightness-95 ${tone}`}
        title={`${row.recordLabel} · ${assignee} · ${row.status}`}
      >
        <span className="truncate">{row.recordLabel}</span>
        <span className="ml-1 font-medium opacity-70">{assignee}</span>
      </button>
      <WorkOrderAssignPopover
        row={row}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        onAssigned={() => onAssigned?.()}
      />
    </>
  );
}
