'use client';

import {
  OrderIdChip,
  PlatformChip,
  TrackingOrSkuScanChip,
  TrackingCountChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { RowTitle, RowMetaColumns } from '@/components/ui/RowMetaColumns';
import { getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { useOrderChannelLabel } from '@/hooks/useCatalog';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import {
  dashboardOrderRowShellClass,
  dashboardOrderRowChipsClass,
} from '@/lib/dashboard-order-row-layout';
import { formatSalePrice, type QueueRowRecord } from './helpers';

/**
 * Collapsed-header content for a {@link CollapsibleGroupRow} wrapping several
 * order lines that share ONE order number but are DIFFERENT products (e.g. a
 * marketplace order with two items shipped under the same — or different —
 * tracking). Built from the same RowTitle / RowMetaColumns / chip primitives a
 * single line uses, so the header reads like a real row and aligns with the
 * child rows it reveals.
 *
 * The order number is the shared identity (one real #chip); tracking shows one
 * value when the lines ship together, else a ×N count ({@link TrackingCountChip}).
 */
export function OrderGroupSummary({ rows, isMobile }: { rows: ShippedOrder[]; isMobile: boolean }) {
  const orderChannelLabel = useOrderChannelLabel();
  const first = rows[0];
  const orderId = String(first.order_id || '').trim();
  const platformLabel = orderChannelLabel(orderId, first.account_source);
  const isFba = isFbaOrder(orderId, first.account_source);
  const productPageUrl = getExternalUrlByItemNumber(String(first.item_number || '').trim());
  const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
  const platformIconClass = platformLabel && productPageUrl ? platformColor : 'text-text-soft';

  const qtySum = rows.reduce((sum, r) => sum + (parseInt(String(r.quantity || '1'), 10) || 1), 0);
  const conditions = new Set(rows.map((r) => String(r.condition || '').trim()).filter(Boolean));
  const conditionText = conditions.size === 1 ? [...conditions][0] : conditions.size > 1 ? 'MIXED' : 'N/A';

  // Combined sale price across the lines that share this order number.
  const priceSum = rows.reduce((sum, r) => {
    const n = r.sale_amount == null || r.sale_amount === '' ? NaN : Number(r.sale_amount);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const groupPrice = priceSum > 0 ? formatSalePrice(priceSum, rows.find((r) => r.currency)?.currency) : null;

  const trackings = new Set(
    rows
      .map((r) => String(((r as QueueRowRecord).tracking_number as string | undefined) || r.shipping_tracking_number || '').trim())
      .filter(Boolean),
  );
  const trackingValue = trackings.size === 1 ? [...trackings][0] : '';

  const platformNode = !isFba ? (
    <PlatformChip
      label={platformLabel}
      underlineClass={getOrderPlatformBorderColor(platformLabel)}
      iconClass={platformIconClass}
      onClick={() => {
        if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
      }}
    />
  ) : null;
  const trackingNode = trackingValue
    ? <TrackingOrSkuScanChip value={trackingValue} />
    : trackings.size > 1
      ? <TrackingCountChip count={trackings.size} />
      : null;

  // The row's platform / order-id / tracking columns line up column-for-column
  // with the child rows beneath.
  const columns: ChipColumn[] = [
    { key: 'platform', width: CHIP_COL.platform, node: platformNode },
    { key: 'orderid', width: CHIP_COL.id, node: <OrderIdChip value={orderId} display={getLast4(orderId)} /> },
    { key: 'tracking', width: CHIP_COL.tracking, node: trackingNode },
  ];

  return (
    <div className={dashboardOrderRowShellClass(isMobile)}>
      <div className="flex min-w-0 flex-col">
        <RowTitle
          // Structural group marker (N products share one order#), not a status —
          // neutral gray so it never collides with a pipeline-state dot hue.
          dot="bg-surface-strong"
          dotTitle={`${rows.length} products`}
          title={platformLabel ? `${platformLabel} · Order ${orderId}` : `Order ${orderId}`}
        />
        <RowMetaColumns
          qty={<span className={qtySum > 1 ? 'text-yellow-600' : 'text-text-soft'}>{qtySum}</span>}
          condition={<span className="text-text-faint">{conditionText}</span>}
          rest={groupPrice ? <span className="normal-case tracking-normal text-emerald-600">{groupPrice}</span> : null}
        />
      </div>
      {isMobile ? (
        <div className={dashboardOrderRowChipsClass(true)}>
          {platformNode}
          <OrderIdChip value={orderId} display={getLast4(orderId)} dense />
          {trackingValue
            ? <TrackingOrSkuScanChip value={trackingValue} />
            : trackings.size > 1
              ? <TrackingCountChip count={trackings.size} dense />
              : null}
        </div>
      ) : (
        <ChipColumns columns={columns} />
      )}
    </div>
  );
}
