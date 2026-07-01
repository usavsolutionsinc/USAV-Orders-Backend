'use client';

/**
 * Page-level modals for the LineEditPanel: the carton audit log (when the line
 * is linked to a shipment) and the support-claim modal. Pure wiring from the
 * controller bag; extracted from LineEditPanel so the panel stays a short
 * composition surface. Behaviour is unchanged.
 */

import { ReceivingAuditModal } from '../ReceivingAuditModal';
import { ReceivingClaimModal } from '../ReceivingClaimModal';
import { SendPhotoNoteModal } from '../SendPhotoNoteModal';
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
      <SendPhotoNoteModal
        open={c.photoNoteOpen}
        row={row}
        onClose={() => c.setPhotoNoteOpen(false)}
      />
      <ReceivingClaimModal
        open={c.claimModalOpen}
        row={row}
        prefillReason={c.returnClaimPrefill ?? undefined}
        onClose={() => {
          c.setClaimModalOpen(false);
          c.setReturnClaimPrefill(null);
        }}
        onTicketCreated={() => {
          void c.invalidateSupportTicket();
          dispatchLineUpdated({ id: row.id, notes: row.notes });
        }}
        onTicketUnlinked={() => {
          void c.invalidateSupportTicket();
        }}
      />
    </>
  );
}
