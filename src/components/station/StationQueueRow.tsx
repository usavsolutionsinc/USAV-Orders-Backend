'use client';

import { SerialChip } from '@/components/ui/CopyChip';
import { OrdersQueueTableRow } from '@/components/dashboard/orders-queue/OrdersQueueTableRow';
import { resolveStationSource, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import type { QueueRowRecord } from '@/components/dashboard/orders-queue/helpers';
import type { StationSourceKind } from '@/lib/station/record-to-queue-row';

/**
 * `StationQueueRow` — the converged station row: a Tech/Packer log rendered
 * through the SAME {@link OrdersQueueTableRow} the Unshipped board uses
 * (station-table-unification-plan §Phase 2/7, success criterion #1). The record
 * is already mapped to a {@link QueueRowRecord} by `record-to-queue-row`; here we
 * only supply the station-specific chrome the queue row leaves to the caller: the
 * SOURCE dot (platform origin) as its `rowStatus`, and — for Tech — the serial
 * chip in the 4th `serialChip` column (Packer rows omit it; their FNSKU already
 * rides the tracking column via the mapper). Reusing the queue row is what gives
 * the station benches selection checkboxes, keyboard focus, and deep-link anchors
 * for free.
 */
export function StationQueueRow({
  record,
  index,
  queueMode,
  selectMode,
  isChecked,
  isSelected,
  isMobile,
  onRowClick,
}: {
  record: QueueRowRecord;
  index: number;
  queueMode: StationSourceKind;
  selectMode: boolean;
  isChecked: boolean;
  isSelected: boolean;
  isMobile: boolean;
  onRowClick: (record: QueueRowRecord, event?: { shiftKey: boolean }) => void;
}) {
  const src = resolveStationSource({
    orderId: record.order_id,
    accountSource: record.account_source,
    trackingType: record.tracking_type,
    scanRef:
      (typeof record.scan_ref === 'string' && record.scan_ref ? record.scan_ref : null) ??
      record.shipping_tracking_number ??
      '',
  });
  const rowStatus = {
    dot: SOURCE_DOT_BG[src.dotType],
    label: SOURCE_DOT_LABEL[src.dotType],
    description: SOURCE_DOT_LABEL[src.dotType],
  };
  const serialChip =
    queueMode === 'tech' ? <SerialChip value={String(record.serial_number || '')} width="w-fit max-w-full" /> : undefined;

  return (
    <OrdersQueueTableRow
      record={record}
      isSelected={isSelected}
      selectMode={selectMode}
      isChecked={isChecked}
      isMobile={isMobile}
      useAlternateStripe={index % 2 === 0}
      testerDisplay="---"
      packerDisplay="---"
      testerId={null}
      packerId={null}
      rowStatus={rowStatus}
      serialChip={serialChip}
      hasOutOfStock={false}
      outOfStockValue=""
      notesValue={String(record.notes || '')}
      daysLate={null}
      disableEnterAnimation
      onRowClick={(_rec, event) => onRowClick(record, event)}
    />
  );
}
