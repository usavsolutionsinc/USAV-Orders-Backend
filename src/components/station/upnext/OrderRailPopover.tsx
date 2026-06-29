'use client';

import { OrderIdChip, TrackingChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { railRelativeTime } from '@/components/sidebar/rail-shell/sidebar-rail-shared';
import { formatMonthDay } from '@/utils/date';
import { getDaysLateTone } from '@/utils/upnext-helpers';
import { describeOrderUrgency } from './order-row-vm';
import type { Order } from './upnext-types';

/**
 * Rich hover-preview content for a tech Up-Next order row — the drop-in shown by
 * the shared `RailPopover` (positioned via `useRailHoverPreview`). The order
 * analogue of the receiving rail's preview: full title, the urgency/ship-by
 * read, copy-chips for order/tracking/SKU, and a primary "Open →" action. Keeps
 * the same popover anatomy so both sidebars feel like one primitive.
 */
export function OrderRailPopover({
  order,
  daysLate,
  quantity,
  displayShipByDate,
  onOpen,
}: {
  order: Order;
  daysLate: number | null;
  quantity: number;
  displayShipByDate: string | null | undefined;
  onOpen: () => void;
}) {
  const title = order.product_title || `Order #${order.order_id}`;
  const channel = order.account_source || 'Order';
  const assignee = order.tester_name && String(order.tester_name).trim() ? order.tester_name : null;
  const shipBy = formatMonthDay(displayShipByDate) || '—';
  const urgencyText = describeOrderUrgency(daysLate);
  const urgencyTone = getDaysLateTone(daysLate);
  const condition = (order.condition || '').trim();
  const tracking = (order.shipping_tracking_number || '').trim();
  const sku = (order.sku || '').trim();
  const orderId = (order.order_id || '').trim();

  return (
    <div className="space-y-3 p-3.5">
      <div>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm font-black leading-snug text-gray-900">{title}</p>
          {condition ? (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-slate-700 ring-1 ring-inset ring-slate-200">
              {condition}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-caption font-semibold text-gray-500">
          <span className="font-mono font-bold text-gray-700">#{getLast4(orderId)}</span>
          <span className="text-gray-300">·</span>
          <span className="truncate">{channel}</span>
          {assignee ? (
            <>
              <span className="text-gray-300">·</span>
              <span className="truncate text-gray-700">{assignee}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="flex items-center gap-1.5 text-caption">
          <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
            {shipBy}
          </span>
          <span className={`font-bold tracking-tight ${urgencyTone}`}>{urgencyText}</span>
        </div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-micro font-bold text-gray-600">
          ×{quantity}
        </span>
      </div>

      <div className="flex flex-nowrap items-center justify-between gap-1.5 overflow-x-auto border-t border-gray-100 pt-3 [&>*]:shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <OrderIdChip value={orderId} display={getLast4(orderId)} />
        <SkuScanRefChip value={sku} display={getLast4(sku)} />
        <TrackingChip value={tracking} display={getLast4(tracking)} />
      </div>

      {order.out_of_stock && String(order.out_of_stock).trim() ? (
        <div className="flex items-center gap-1.5 rounded-md border border-red-100 bg-red-50/60 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-red-700">
            {order.out_of_stock}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
        <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
          {railRelativeTime(order.created_at)} ago
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="ds-raw-button rounded-md bg-blue-600 px-2.5 py-1 text-micro font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          Open →
        </button>
      </div>
    </div>
  );
}
