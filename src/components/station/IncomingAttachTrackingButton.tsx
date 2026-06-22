'use client';

/**
 * Row-anchored "Add tracking" — only rendered on Incoming AWAITING_TRACKING rows
 * (PO exists, no shipment registered yet). Opens the attach popover pre-targeted
 * to this PO, so the operator attaches tracking without re-searching for the PO
 * they're already looking at. stopPropagation keeps the click off the row's
 * select / group-toggle handlers. Extracted from ReceivingLinesTable.
 */

import { Link2 } from '@/components/Icons';
import { AddValueChipFace } from '@/components/ui/CopyChip';
import { IncomingAttachTrackingPopover } from '@/components/sidebar/receiving/IncomingAttachTrackingPopover';

export function IncomingAttachTrackingButton({
  poId,
  poNumber,
}: {
  poId: string;
  poNumber: string | null;
}) {
  return (
    <IncomingAttachTrackingPopover
      presetPo={{ poId, poNumber }}
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          title="Attach a tracking number to this PO before the box arrives"
          // Sits in the empty tracking chip slot — the shared AddValueChipFace
          // (dashed underline = "nothing here yet, click to add"). Same face the
          // dashboard paste-tracking button uses, so the two can't drift.
          // `px-1.5` mirrors CopyChip's `outerPad='chip'` gutter so this empty
          // state lines up flush with the filled TrackingChip below it in the
          // ChipColumns grid (whose `-mr-1.5` cancels that same trailing gutter).
          className="inline-flex shrink-0 items-center px-1.5 transition-colors"
        >
          <AddValueChipFace label="+ TRK#" icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} size="chip" />
        </button>
      }
    />
  );
}
