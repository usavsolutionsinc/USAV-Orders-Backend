'use client';

import { SerialChip } from '@/components/ui/CopyChip';
import { ChipColumns } from '@/components/ui/ChipColumns';
import { buildStationChipColumns, buildStationFnskuColumns } from '@/components/station/station-chip-columns';
import { StationRecordShell } from '@/components/station/StationRecordShell';
import { useOrderChannelLabel } from '@/hooks/useCatalog';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { getOrderDisplayValues } from '@/utils/order-display';
import { resolveStationSource } from '@/utils/source-dot';
import { type TechRecord } from '@/hooks/useTechLogs';
import { hasUsableProductTitle } from '@/hooks/station/useTechTableController';
import { normalizeProductTitle } from '@/components/station/tech-record-mappers';

export interface TechRecordRowProps {
  record: TechRecord;
  index: number;
  onOpen: (record: TechRecord) => void;
}

/**
 * One tech-station row — source dot, title, qty/condition meta, and the
 * fixed-column chip grid (platform / order-id / tracking / serial) shared with
 * the shipped table. FNSKU rows take the tracking + serial columns.
 */
export function TechRecordRow({ record, index, onOpen }: TechRecordRowProps) {
  const orderChannelLabel = useOrderChannelLabel();
  const displayValues = getOrderDisplayValues({
    sku: record.sku,
    condition: record.condition,
    trackingNumber: record.shipping_tracking_number,
  });
  const isFbaRow =
    record.account_source === 'fba' ||
    record.source_kind === 'fba_scan' ||
    String(record.order_id || '').toUpperCase() === 'FBA';
  const rawCondition = String(record.condition || '').trim();
  const conditionLabel = isFbaRow
    ? !rawCondition || /^fba\s*scan$/i.test(rawCondition)
      ? 'N/A'
      : rawCondition
    : displayValues.condition || 'No Condition';
  const fnskuValue = String(record.fnsku || '').trim();
  const isFnskuRow = Boolean(fnskuValue);
  const { dotType, isSku } = resolveStationSource({
    orderId: record.order_id,
    accountSource: record.account_source,
    trackingType: null,
    scanRef: record.shipping_tracking_number,
  });
  const hideOrderIdChip = isSku || Boolean(record.has_sku_serial_source);

  const serialNode = <SerialChip value={record.serial_number || ''} width="w-fit max-w-full" />;

  let chipGrid: React.ReactNode;
  if (isFnskuRow) {
    chipGrid = <ChipColumns columns={buildStationFnskuColumns({ fnskuValue, serialNode })} />;
  } else {
    const plat = orderChannelLabel(record.order_id || '', record.account_source);
    const productUrl = getExternalUrlByItemNumber(
      String(record.item_number || '').trim() ||
        skuScanPrefixBeforeColon(record.shipping_tracking_number),
    );
    chipGrid = (
      <ChipColumns
        columns={buildStationChipColumns({
          plat,
          productUrl,
          orderId: record.order_id,
          hideOrderIdChip,
          trackingValue: record.shipping_tracking_number || '',
          serialNode,
        })}
      />
    );
  }

  return (
    <StationRecordShell
      dotType={dotType}
      title={
        hasUsableProductTitle(record.product_title)
          ? normalizeProductTitle(record.product_title)
          : 'Unknown Product'
      }
      quantity={parseInt(String(record.quantity || '1'), 10) || 1}
      condition={conditionLabel}
      chipGrid={chipGrid}
      index={index}
      onClick={() => onOpen(record)}
    />
  );
}
