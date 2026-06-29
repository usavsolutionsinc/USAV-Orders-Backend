'use client';

import { useRef, useState } from 'react';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { STATUS_COLOR } from '@/components/work-orders/types';
import { WorkOrderAssignPopover } from '@/components/work-orders/WorkOrderAssignPopover';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

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
      <HoverTooltip label={`${row.recordLabel} · ${assignee} · ${row.status}`} asChild>
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen(true)}
          className={`ds-raw-button block w-full truncate rounded px-1.5 py-0.5 text-left text-micro font-semibold leading-tight transition-colors hover:brightness-95 ${tone}`}
        >
          <span className="truncate">{row.recordLabel}</span>
          <span className="ml-1 font-medium opacity-70">{assignee}</span>
        </button>
      </HoverTooltip>
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
