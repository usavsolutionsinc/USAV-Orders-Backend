'use client';

/**
 * Triage "Unfound" list — cartons scanned at the door that Zoho can't match to
 * a PO yet (`kind='unmatched_receiving'` in `v_unfound_queue`). Tap a row to
 * open it in the triage detail pane and add identifiable info (classify, add an
 * item, link a PO#). Rows auto-drop once Zoho syncs the PO or the operator links
 * one manually.
 *
 * Pure composition: the rail is a thin binding over {@link ReceivingFeedRail}
 * (feed `triageUnfound`), and the two triage-specific affordances are behavior
 * hooks wired into the rail's optional popover slots:
 *   • B3 — read-only Zoho-sync exception dot + tooltip ({@link useTriageUnfoundExceptions}).
 *   • B2 — a "Claim" action opening `ReceivingClaimModal` ({@link useReceivingClaimModal}),
 *     filed at the carton level (the unfound row is a synthetic stub with no real
 *     receiving_line).
 */

import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { Flag } from '@/components/Icons';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { exceptionDotClass, exceptionTooltipLabel } from '@/lib/receiving/triage-exception-context';
import { ReceivingFeedRail } from './ReceivingFeedRail';
import { useTriageUnfoundExceptions } from './useTriageUnfoundExceptions';
import { useReceivingClaimModal } from './useReceivingClaimModal';

export function TriageUnfoundList({
  selectedLineId,
  filterText = '',
}: {
  selectedLineId: number | null;
  filterText?: string;
}) {
  const exceptionMap = useTriageUnfoundExceptions();
  const { claimRow, openClaim, closeClaim, onTicketCreated } = useReceivingClaimModal();

  return (
    <>
      <ReceivingFeedRail
        feed="triageUnfound"
        selectedLineId={selectedLineId}
        filterText={filterText}
        renderPopoverContext={(row) => {
          // B3: open Zoho-sync exception state for this carton (read-only).
          const ctx = row.receiving_id != null ? exceptionMap?.get(row.receiving_id) : undefined;
          if (!ctx) return null;
          return (
            <div className="flex items-center gap-2 border-t border-gray-100 pt-2.5">
              <HoverTooltip label={exceptionTooltipLabel(ctx)} asChild>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${exceptionDotClass(ctx)}`} />
                  <span className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
                    Zoho sync pending · {ctx.retryCount}×
                  </span>
                </span>
              </HoverTooltip>
            </div>
          );
        }}
        renderPopoverActions={(row, { dismiss }) => (
          // B2: file a Zendesk claim for this unfound carton straight from triage.
          <HoverTooltip label="File a missing-carton / unfound claim for this package" asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                openClaim(row);
                dismiss();
              }}
              className="h-auto gap-1 rounded-md px-2 py-1 text-micro font-black uppercase tracking-widest text-orange-600 hover:bg-orange-50"
            >
              <Flag className="h-3.5 w-3.5" />
              Claim
            </Button>
          </HoverTooltip>
        )}
      />

      {claimRow ? (
        <ReceivingClaimModal
          open
          row={claimRow}
          // Carton-level claim — the unfound stub has no real receiving_line.
          lineIdOverride={null}
          onClose={closeClaim}
          onTicketCreated={onTicketCreated}
        />
      ) : null}
    </>
  );
}
