import { toast } from '@/lib/toast';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingAuditModal } from '@/components/receiving/workspace/ReceivingAuditModal';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';

/** The claim and audit overlays for the testing panel. SKU pairing lives inline in {@link LineTestingTabbedCard}. */
export function TestingPanelModals({
  c,
  row,
}: {
  c: TestingController;
  row: ReceivingLineRow;
}) {
  return (
    <>
      <ReceivingClaimModal
        open={c.claimOpen}
        row={row}
        onClose={() => c.setClaimOpen(false)}
        onTicketCreated={(tk) => {
          toast.success(`Claim filed — ${tk}`);
          dispatchLineUpdated({ id: row.id, zendesk_ticket: tk });
        }}
      />

      {row.receiving_id != null ? (
        <ReceivingAuditModal open={c.auditOpen} onClose={() => c.setAuditOpen(false)} receivingId={row.receiving_id} />
      ) : null}
    </>
  );
}
