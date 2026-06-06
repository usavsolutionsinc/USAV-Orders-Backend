'use client';

import { OrderIdChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { getDaysLateNullable, getDaysLateTone } from '@/utils/date';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';

/**
 * Pending-order row for the mobile Picks feed — the phone view of the
 * dashboard `?pending=` table. Mirrors MobileReceivingRow / MobilePackingRow:
 * same MobileRowCard chrome + shared CopyChips, so all mobile displays share
 * one set of primitives.
 *
 *   Row 1: deadline-tone dot + product title
 *   Row 2: [qty • condition • days-late] … [order] [tracking]
 *
 * Only order# + tracking chips: pending orders carry no SKU/serial context yet
 * (assigned after the pick). Deadline shows just the days-late number, tone-
 * coloured, exactly like the dashboard pending/orders queue.
 */

function deadlineOf(o: ShippedOrder): string | null {
  return o.ship_by_date || o.deadline_at || null;
}

/** Status dot bg by days late — mirrors getDaysLateTone (red/yellow/emerald/gray). */
function dotTone(daysLate: number | null): string {
  if (daysLate === null) return 'bg-gray-300';
  if (daysLate > 1) return 'bg-rose-500';
  if (daysLate === 1) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function PendingOrderRow({
  row,
  variant,
  fresh = false,
  onTap,
}: {
  row: ShippedOrder;
  variant: 'collapsed' | 'expanded';
  fresh?: boolean;
  onTap: () => void;
}) {
  const productTitle = row.product_title || row.item_number || row.sku || 'Untitled order';
  const quantity = parseInt(String(row.quantity || '1'), 10) || 1;
  const orderId = (row.order_id || '').trim();
  const trackingValue = (row.shipping_tracking_number || '').trim();
  const conditionLabel = (row.condition || '').trim().toUpperCase() || 'N/A';
  const condColor =
    conditionLabel === 'BRAND_NEW' || conditionLabel === 'BRAND NEW'
      ? 'text-yellow-600'
      : conditionLabel === 'PARTS'
        ? 'text-amber-800'
        : 'text-gray-500';

  const daysLate = getDaysLateNullable(deadlineOf(row));

  return (
    <MobileRowCard variant={variant} fresh={fresh} onTap={onTap} dataAttr={{ name: 'order-row-id', value: row.id }}>
      {/* Title — same primitive + wide dot-track as receiving/packing so the dot
          and title start at the identical x across every mobile feed. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RowTitle dot={dotTone(daysLate)} dotTrack={META_COL.dotTrackWide} title={productTitle} />
        </div>
        {row.account_source && (
          <span className="shrink-0 rounded-full border border-blue-100/60 bg-blue-50 px-2 py-0.5 text-[8.5px] font-black uppercase tracking-[0.1em] text-blue-500">
            {row.account_source}
          </span>
        )}
      </div>

      <div className="pointer-events-auto mt-0.5 flex items-center gap-2">
        <RowMetaColumns
          className="!mt-0 shrink-0"
          indent={META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={<span className={quantity > 1 ? 'text-yellow-600' : 'text-gray-900'}>{quantity}</span>}
          condition={<span className={condColor}>{conditionLabel}</span>}
          rest={
            daysLate !== null ? (
              <span className={`tabular-nums ${getDaysLateTone(daysLate)}`}>{daysLate}</span>
            ) : undefined
          }
        />

        <div className="ml-auto flex min-w-0 items-center gap-2 pointer-events-auto">
          {orderId && <OrderIdChip value={orderId} display={getLast4(orderId)} />}
          {trackingValue && <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />}
        </div>
      </div>
    </MobileRowCard>
  );
}

export default PendingOrderRow;
