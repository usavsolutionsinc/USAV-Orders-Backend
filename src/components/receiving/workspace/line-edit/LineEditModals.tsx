'use client';

/**
 * Page-level modals for the LineEditPanel: the carton audit log (when the line
 * is linked to a shipment) and the support-claim modal. Pure wiring from the
 * controller bag; extracted from LineEditPanel so the panel stays a short
 * composition surface. Behaviour is unchanged.
 */

import { ReceivingAuditModal } from '../ReceivingAuditModal';
import { ReceivingClaimModal } from '../ReceivingClaimModal';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { UnboxLineController } from './unbox-line-controller';

interface LineEditModalsProps {
  row: ReceivingLineRow;
  c: UnboxLineController;
}

export function LineEditModals({ row, c }: LineEditModalsProps) {
  return (
    <>
      {row.receiving_id != null ? (
        <ReceivingAuditModal
          open={c.auditOpen}
          onClose={() => c.setAuditOpen(false)}
          receivingId={row.receiving_id}
        />
      ) : null}
      <ReceivingClaimModal
        open={c.claimModalOpen}
        row={row}
        prefillReason={c.returnClaimPrefill ?? undefined}
        onClose={() => {
          c.setClaimModalOpen(false);
          c.setReturnClaimPrefill(null);
        }}
        onTicketCreated={(tk) => {
          // Keep the in-memory zendesk value in sync (persisted to the line by
          // the claim route + the Receive/patch save flow).
          if (!c.zendesk.trim()) c.setZendesk(tk);
          dispatchLineUpdated({ id: row.id, notes: row.notes });
        }}
        onTicketUnlinked={() => {
          c.setZendesk('');
          dispatchLineUpdated({ id: row.id, zendesk_ticket: null, notes: row.notes });
        }}
      />
    </>
  );
}
