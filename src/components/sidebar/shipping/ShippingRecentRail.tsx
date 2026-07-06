'use client';

import { useCallback, useMemo, useState } from 'react';
import { SidebarRailShell } from '@/components/sidebar/SidebarRailShell';
import { RailRowBody } from '@/components/sidebar/rail-shell/RailRowBody';
import type { SidebarRailRowContext } from '@/components/sidebar/rail-shell/sidebar-rail-shared';
import { dispatchUpNextPreview } from '@/utils/events';
import {
  getDisplayShipByDate,
  getDaysLateNumber,
} from '@/utils/upnext-helpers';
import { OrderRailPopover } from '@/components/station/upnext/OrderRailPopover';
import {
  getOrderUrgencyDot,
  getOrderUrgencyDotLabel,
  orderToRailVM,
} from '@/components/station/upnext/order-row-vm';
import type { Order } from '@/components/station/upnext/upnext-types';
import { ShippingRailFeedToggle, type ShippingRailFeed } from './ShippingRailFeedToggle';
import { filterShippingRailOrders } from '@/components/sidebar/tech/filter-shipping-rail-orders';
import {
  normalizeUpNextOrders,
  SHIPPING_RAIL_REFRESH_EVENTS,
  shippingRailQueryKey,
  sortOrdersByShipBy,
} from './shipping-rail-shared';
import { useShippingRailActions } from './useShippingRailActions';

interface Props {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: () => void;
  onAllCompleted?: () => void;
  /** Client-side filter over the loaded rail rows. */
  filterText?: string;
}

const getOrderId = (order: Order) => order.id;

function OrderRowMain({ order, ctx }: { order: Order; ctx: SidebarRailRowContext }) {
  const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  const daysLate = getDaysLateNumber(order.ship_by_date, order.created_at);
  const displayShipByDate = getDisplayShipByDate(order);

  return (
    <RailRowBody
      className="flex-1"
      vm={{
        ...orderToRailVM(order, { daysLate, quantity, displayShipByDate }),
        eyebrowTrailing: (
          <span
            aria-hidden
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm leading-none text-text-faint transition-opacity ${
              ctx.isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            ›
          </span>
        ),
      }}
    />
  );
}

/**
 * Sidebar activity rail for the tech Shipping workspace. Mirrors
 * {@link TestingRecentRail}: a sticky feed toggle + {@link SidebarRailShell}
 * rows using the shared `RailRowBody` anatomy. Retires the legacy Up Next
 * card stack (tabs, urgency banners, section headers, inline action rows).
 */
export function ShippingRecentRail({
  techId,
  onStart,
  onMissingParts,
  onAllCompleted,
  filterText = '',
}: Props) {
  const [feed, setFeed] = useState<ShippingRailFeed>('queue');
  const isStock = feed === 'stock';
  const trimmedFilter = filterText.trim();

  const queryKey = useMemo(
    () => [...shippingRailQueryKey(feed, techId), trimmedFilter] as const,
    [feed, techId, trimmedFilter],
  );

  const fetchFn = useCallback(async (): Promise<Order[]> => {
    const res = await fetch(
      `/api/orders/next?all=true&outOfStock=${isStock ? 'true' : 'false'}`,
      { cache: 'no-store' },
    );
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json().catch(() => ({}));
    let rows = normalizeUpNextOrders(data?.orders);
    rows = isStock ? rows : sortOrdersByShipBy(rows);
    if (!trimmedFilter) return rows;
    return filterShippingRailOrders(rows, trimmedFilter);
  }, [isStock, trimmedFilter]);

  const [queueEmpty, setQueueEmpty] = useState(false);
  const loadRows = useCallback(async (): Promise<Order[]> => {
    const rows = await fetchFn();
    if (feed === 'queue') setQueueEmpty(rows.length === 0);
    return rows;
  }, [feed, fetchFn]);

  const { selectedOrderId } = useShippingRailActions({
    techId,
    onStart,
    onMissingParts: () => onMissingParts(),
    onAllCompleted,
    queueEmpty,
  });

  return (
    <>
      <ShippingRailFeedToggle value={feed} onChange={setFeed} />
      <SidebarRailShell<Order>
        queryKey={queryKey}
        fetchFn={loadRows}
        refreshEvents={[...SHIPPING_RAIL_REFRESH_EVENTS]}
        selectedId={selectedOrderId}
        limit={50}
        pinSelectedLead
        staggerReveal
        eyebrowTitle={isStock ? 'Out of Stock' : 'Up Next'}
        eyebrowSuffix={isStock ? 'Needs parts' : 'Ship by date'}
        emptyText={isStock ? 'No out-of-stock orders' : 'No orders in queue'}
        getId={getOrderId}
        onSelect={(order) => {
          dispatchUpNextPreview(
            selectedOrderId === order.id ? null : { kind: 'order', order },
          );
        }}
        getStatusDot={(order) => getOrderUrgencyDot(getDaysLateNumber(order.ship_by_date, order.created_at))}
        getStatusDotLabel={(order) =>
          getOrderUrgencyDotLabel(getDaysLateNumber(order.ship_by_date, order.created_at))
        }
        renderRowMain={(order, ctx) => <OrderRowMain order={order} ctx={ctx} />}
        renderPopover={(order, p) => {
          const quantity = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
          const daysLate = getDaysLateNumber(order.ship_by_date, order.created_at);
          const displayShipByDate = getDisplayShipByDate(order);
          return (
            <OrderRailPopover
              order={order}
              daysLate={daysLate}
              quantity={quantity}
              displayShipByDate={displayShipByDate}
              onOpen={() => {
                dispatchUpNextPreview({ kind: 'order', order });
                p.dismiss();
              }}
            />
          );
        }}
      />
    </>
  );
}
