'use client';

import type React from 'react';
import {
  FnskuChip,
  OrderIdChip,
  OrderIdChipPlaceholder,
  TrackingOrSkuScanChip,
  PlatformChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';

/**
 * Shared station-row chip-grid builders. Tech + Packer rows (and the shipped
 * table layout) all render the SAME fixed-column grid — platform / order-id /
 * tracking, optionally + serial — so the column construction lives here once
 * instead of being copy-pasted per row. Each row keeps its own record-specific
 * derivation (dot input fields, condition/title, FNSKU source, motion wrapper)
 * and just feeds normalized values in. A step toward the chassis
 * `StationRecordRow` (docs/station-chassis-refactor-discovery.md).
 */

export interface StationChipColumnsOpts {
  /** Platform label (already resolved via the catalog-aware useOrderChannelLabel). */
  plat: string;
  /** External product URL; gates the platform chip's click + color. */
  productUrl: string | null | undefined;
  orderId: string | null | undefined;
  /** Render the order-id placeholder instead of the chip (SKU-source rows). */
  hideOrderIdChip: boolean;
  trackingValue: string;
  /** When provided, appends a serial column (tech rows); omit for packer rows. */
  serialNode?: React.ReactNode;
}

/** platform / order-id / tracking [/ serial]. */
export function buildStationChipColumns({
  plat,
  productUrl,
  orderId,
  hideOrderIdChip,
  trackingValue,
  serialNode,
}: StationChipColumnsOpts): ChipColumn[] {
  const columns: ChipColumn[] = [
    {
      key: 'platform',
      width: CHIP_COL.platform,
      node: (
        <PlatformChip
          label={plat}
          underlineClass={getOrderPlatformBorderColor(plat)}
          iconClass={plat && productUrl ? getOrderPlatformColor(plat) : 'text-text-soft'}
          onClick={() => {
            if (productUrl) window.open(productUrl, '_blank', 'noopener,noreferrer');
          }}
        />
      ),
    },
    {
      key: 'orderid',
      width: CHIP_COL.id,
      node: hideOrderIdChip ? (
        <OrderIdChipPlaceholder />
      ) : (
        <OrderIdChip value={orderId || ''} display={getLast4(orderId)} />
      ),
    },
    {
      key: 'tracking',
      width: CHIP_COL.tracking,
      node: <TrackingOrSkuScanChip value={trackingValue} />,
    },
  ];
  if (serialNode !== undefined) {
    columns.push({ key: 'serial', width: CHIP_COL.serial, node: serialNode });
  }
  return columns;
}

export interface StationFnskuColumnsOpts {
  fnskuValue: string;
  /** When provided, appends a serial column (tech rows); omit for packer rows. */
  serialNode?: React.ReactNode;
}

/** FNSKU variant: platform + order-id reserved (null, keeps columns aligned),
 *  FNSKU in the tracking column, optional serial column. */
export function buildStationFnskuColumns({
  fnskuValue,
  serialNode,
}: StationFnskuColumnsOpts): ChipColumn[] {
  const columns: ChipColumn[] = [
    { key: 'platform', width: CHIP_COL.platform, node: null },
    { key: 'orderid', width: CHIP_COL.id, node: null },
    { key: 'tracking', width: CHIP_COL.tracking, node: <FnskuChip value={fnskuValue} /> },
  ];
  if (serialNode !== undefined) {
    columns.push({ key: 'serial', width: CHIP_COL.serial, node: serialNode });
  }
  return columns;
}
