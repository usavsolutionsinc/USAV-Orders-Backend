'use client';

import type { WorkOrderRow } from './types';
import {
  FnskuChip,
  OrderIdChip,
  TicketChip,
  TrackingOrSkuScanChip,
  getLast4,
} from '@/components/ui/CopyChip';

export function WorkOrderInfoChips({ row }: { row: WorkOrderRow }) {
  const idStr = String(row.entityId);

  switch (row.entityType) {
    case 'ORDER': {
      const orderValue = String(row.orderId || row.recordLabel || '').trim();
      const trackingValue = String(row.trackingNumber || '').trim();
      return (
        <>
          <OrderIdChip value={orderValue} display={getLast4(orderValue)} />
          <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        </>
      );
    }
    case 'REPAIR': {
      const ticket = String(row.recordLabel || '').trim();
      return (
        <>
          <TicketChip value={ticket} display={getLast4(ticket)} />
          <OrderIdChip value={idStr} display={getLast4(idStr)} />
        </>
      );
    }
    case 'FBA_SHIPMENT': {
      const ref = String(row.recordLabel || '').trim();
      return (
        <>
          <FnskuChip value={ref} />
          <OrderIdChip value={idStr} display={getLast4(idStr)} />
        </>
      );
    }
    case 'SKU_STOCK': {
      const sku = String(row.sku || row.recordLabel || '').trim();
      return (
        <>
          <FnskuChip value={sku} />
          <OrderIdChip value={idStr} display={getLast4(idStr)} />
        </>
      );
    }
    case 'RECEIVING': {
      const track = String(row.recordLabel || '').trim();
      return (
        <>
          <TrackingOrSkuScanChip value={track} />
          <OrderIdChip value={idStr} display={getLast4(idStr)} />
        </>
      );
    }
  }
}

export function WorkOrderInfoStrip({
  row,
  className = 'mt-1 flex min-w-0 max-w-full items-center justify-between gap-2',
}: {
  row: WorkOrderRow;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-gray-500">
        Work Order Info -
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <WorkOrderInfoChips row={row} />
      </div>
    </div>
  );
}
