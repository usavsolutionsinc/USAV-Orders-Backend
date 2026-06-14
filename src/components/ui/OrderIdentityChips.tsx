'use client';

import {
  OrderIdChip,
  OrderIdChipPlaceholder,
  TrackingOrSkuScanChip,
  PlatformChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { dashboardOrderRowChipsClass } from '@/lib/dashboard-order-row-layout';

/**
 * The platform · order-id · tracking chip cluster shared by the dashboard
 * order-row tables (unshipped queue, shipped, packer, tech). The right-side
 * mirror of {@link RowMetaColumns} for identities — pass the resolved values +
 * flags and it lays them out as fixed-width {@link ChipColumns} on desktop / a
 * flowing row on mobile, column-for-column with its siblings.
 *
 * The tracking column hosts an action in its empty slot via {@link trackingAction}
 * (e.g. the paste-tracking "Add TRK#" affordance) — the same trackingAction-slot
 * pattern {@link ReceivingIdentityChips} uses, so the two surfaces can't drift.
 *
 * Presentational only: callers resolve platform label/colors/url + the hide /
 * fba flags and pass them in (keeps this component free of platform-util
 * imports, matching {@link ReceivingIdentityChips}).
 */
export interface OrderIdentityChipsProps {
  platformLabel: string;
  /** Icon color for the platform chip (gray when not linkable). */
  platformIconClass: string;
  /** Underline color for the platform chip. */
  platformBorderClass: string;
  /** Product page opened on platform-chip click; null disables the link. */
  productPageUrl: string | null;
  /** FBA orders carry no platform chip — the column stays empty for alignment. */
  isFba: boolean;
  orderId: string;
  /** SKU-source rows hide the order-id chip (placeholder keeps columns aligned). */
  hideOrderId: boolean;
  /** Raw tracking / scan ref; when empty the {@link trackingAction} shows instead. */
  tracking: string;
  /** Action node for the empty tracking slot (ignored when `tracking` is present). */
  trackingAction?: React.ReactNode;
  isMobile: boolean;
}

export function OrderIdentityChips({
  platformLabel,
  platformIconClass,
  platformBorderClass,
  productPageUrl,
  isFba,
  orderId,
  hideOrderId,
  tracking,
  trackingAction,
  isMobile,
}: OrderIdentityChipsProps) {
  const columns: ChipColumn[] = [
    {
      key: 'platform',
      width: CHIP_COL.platform,
      node: !isFba ? (
        <PlatformChip
          label={platformLabel}
          underlineClass={platformBorderClass}
          iconClass={platformIconClass}
          onClick={() => {
            if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
          }}
        />
      ) : null,
    },
    {
      key: 'orderid',
      width: CHIP_COL.id,
      node: hideOrderId ? (
        <OrderIdChipPlaceholder />
      ) : (
        <OrderIdChip value={orderId} display={getLast4(orderId)} />
      ),
    },
    {
      key: 'tracking',
      width: CHIP_COL.tracking,
      // Empty tracking slot hosts the action (paste "Add TRK#") instead of a
      // value chip — only when there's genuinely no tracking.
      node: tracking ? <TrackingOrSkuScanChip value={tracking} /> : (trackingAction ?? null),
    },
  ];

  return isMobile ? (
    <div className={dashboardOrderRowChipsClass(true)}>
      {columns.map((c) => c.node && <span key={c.key} className="contents">{c.node}</span>)}
    </div>
  ) : (
    <ChipColumns columns={columns} />
  );
}
