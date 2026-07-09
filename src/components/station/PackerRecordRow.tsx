'use client';

import { ChipColumns } from '@/components/ui/ChipColumns';
import { buildStationChipColumns, buildStationFnskuColumns } from '@/components/station/station-chip-columns';
import { StationRecordShell } from '@/components/station/StationRecordShell';
import { useOrderChannelLabel } from '@/hooks/useCatalog';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { getOrderDisplayValues } from '@/utils/order-display';
import { resolveStationSource } from '@/utils/source-dot';
import { type PackerRecord } from '@/hooks/usePackerLogs';
import { isFbaPackerRecord } from '@/hooks/station/usePackerTableController';

export interface PackerRecordRowProps {
  record: PackerRecord;
  index: number;
  onOpen: (record: PackerRecord) => void;
}

/**
 * One packer-station row — source dot, title, qty/condition meta, and the
 * fixed-column chip grid (platform / order-id / tracking) shared with the
 * shipped + tech tables. No serial column; FBA rows take the tracking column
 * for their FNSKU.
 */
export function PackerRecordRow({ record, index, onOpen }: PackerRecordRowProps) {
  const orderChannelLabel = useOrderChannelLabel();
  const displayValues = getOrderDisplayValues({
    sku: record.sku,
    condition: record.condition,
    trackingNumber: record.shipping_tracking_number,
  });
  const rowIsFba = isFbaPackerRecord(record);
  const fnskuValue = String(record.scan_ref || '').trim();
  const showFnskuChip = rowIsFba && Boolean(fnskuValue);
  const { dotType, isSku: hideOrderIdChip } = resolveStationSource({
    orderId: record.order_id,
    accountSource: record.account_source,
    trackingType: record.tracking_type,
    scanRef: record.scan_ref,
  });

  let chipGrid: React.ReactNode;
  if (showFnskuChip) {
    // No serial column on packer rows; FBA rows take the tracking column for FNSKU.
    chipGrid = <ChipColumns columns={buildStationFnskuColumns({ fnskuValue })} />;
  } else {
    const plat = orderChannelLabel(record.order_id || '', record.account_source);
    const scanForSku = String(record.scan_ref || record.shipping_tracking_number || '');
    const productUrl = getExternalUrlByItemNumber(
      String(record.item_number || '').trim() || skuScanPrefixBeforeColon(scanForSku),
    );
    chipGrid = (
      <ChipColumns
        columns={buildStationChipColumns({
          plat,
          productUrl,
          orderId: record.order_id,
          hideOrderIdChip,
          trackingValue: record.shipping_tracking_number || '',
        })}
      />
    );
  }

  return (
    <StationRecordShell
      animated
      dotType={dotType}
      title={record.product_title || record.item_number || record.sku || 'Unknown Product'}
      quantity={parseInt(String(record.quantity || '1'), 10) || 1}
      condition={displayValues.condition || 'No Condition'}
      chipGrid={chipGrid}
      index={index}
      onClick={() => onOpen(record)}
    />
  );
}
