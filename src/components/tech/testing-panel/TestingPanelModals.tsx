import { toast } from '@/lib/toast';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingAuditModal } from '@/components/receiving/workspace/ReceivingAuditModal';
import { SkuPairingModal } from '@/components/products/pairing/SkuPairingModal';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';

/** The three overlays for the testing panel: claim, audit, and SKU pairing. */
export function TestingPanelModals({
  c,
  row,
  productTitle,
}: {
  c: TestingController;
  row: ReceivingLineRow;
  productTitle: string;
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

      <SkuPairingModal
        open={c.pairOpen}
        onClose={() => c.setPairOpen(false)}
        skuCatalogId={row.sku_catalog_id ?? null}
        headerTitle={productTitle}
      />
    </>
  );
}
