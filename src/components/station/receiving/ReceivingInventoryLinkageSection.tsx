'use client';

import type { ReceivingDetailFormActions } from '@/hooks/useReceivingDetailForm';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import { TrackingNumberRow } from '@/components/ui/TrackingNumberRow';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { listingUrlForOpen } from '@/components/sidebar/receiving/receiving-sidebar-shared';

export function ReceivingInventoryLinkageSection({
  log,
  form,
}: {
  log: ReceivingDetailsLog;
  form: ReceivingDetailFormActions;
}) {
  const listingRaw = String(log.listing_url || '').trim();
  const poValue = String(log.zoho_purchaseorder_number || log.zoho_purchaseorder_id || '').trim();
  const receiveId = String(log.zoho_purchase_receive_id || '').trim();
  const warehouseId = String(log.zoho_warehouse_id || '').trim();
  const hasAny = Boolean(listingRaw || poValue || receiveId || warehouseId || String(form.tracking || '').trim());

  if (!hasAny) return null;

  return (
    <section className="space-y-2">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Inventory linkage</p>
      <div className="space-y-0">
        <TrackingNumberRow
          label="Tracking"
          value={form.tracking}
          placeholder="Tracking number"
          allowEdit
          onChange={form.setTracking}
          onBlur={() => void form.saveTrackingIfDirty()}
          keepBottomDivider={Boolean(listingRaw || poValue || receiveId || warehouseId)}
        />
        {listingRaw ? (
          <CopyableValueFieldBlock
            label="Listing"
            value={listingRaw}
            externalUrl={listingUrlForOpen(listingRaw)}
            externalLabel="Open listing"
            variant="flat"
            twoLineValue
            noTruncate
            keepBottomDivider
          />
        ) : null}
        {poValue ? (
          <CopyableValueFieldBlock
            label="PO number"
            value={poValue}
            variant="flat"
            keepBottomDivider
          />
        ) : null}
        {receiveId ? (
          <CopyableValueFieldBlock
            label="Zoho receive"
            value={receiveId}
            variant="flat"
            keepBottomDivider
          />
        ) : null}
        {warehouseId ? (
          <CopyableValueFieldBlock
            label="Warehouse"
            value={warehouseId}
            variant="flat"
          />
        ) : null}
      </div>
    </section>
  );
}

