'use client';

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  displayTrackingNumber,
  fulfillmentModeLabel,
  isLocalPickupFulfillment,
} from '@/lib/receiving/fulfillment-mode';
import {
  OrderIdChip,
  SkuScanRefChip,
  TrackingChip,
  SerialChip,
  getLast4,
  getLast8,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/** Matches {@link InlinePillPicker} collapsed shell — read-only status pills in the carton bar. */
const RAIL_PILL_BASE =
  'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide';
const RAIL_PICKUP_TONE = 'border-emerald-600 bg-emerald-600 text-white';

export type FulfillmentPickupPillVariant = 'chip' | 'rail';

/**
 * Non-copy pickup indicator for the tracking slot.
 * - `chip` (default) — ring badge for table columns, popovers, dense rows.
 * - `rail` — solid h-8 pill aligned with InlinePillPicker in CartonContextCard.
 */
export function FulfillmentPickupPill({
  dense,
  variant = 'chip',
  tooltip,
}: {
  dense?: boolean;
  variant?: FulfillmentPickupPillVariant;
  /** Rail variant only — explains fulfillment mode on hover/focus. */
  tooltip?: string;
}) {
  if (variant === 'rail') {
    const pill = (
      <span
        className={`${RAIL_PILL_BASE} ${RAIL_PICKUP_TONE}`}
        aria-label={tooltip ?? 'Pickup — fulfilled in person, no tracking number'}
      >
        Pickup
      </span>
    );
    if (tooltip) {
      return (
        <HoverTooltip label={tooltip} asChild>
          {pill}
        </HoverTooltip>
      );
    }
    return pill;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-black uppercase tracking-widest text-emerald-700 ring-1 ring-inset ring-emerald-200 bg-emerald-50 ${
        dense ? 'px-1 py-px text-[8.5px]' : 'px-1.5 py-0.5 text-eyebrow'
      }`}
    >
      Pickup
    </span>
  );
}

/**
 * The slim, color-coded, last-4 chip cluster shared by the desktop receiving
 * table row ({@link ReceivingLineOrderRow}) and the scanned-line / receipt
 * detail headers on mobile. Each chip shows the last-4 preview and copies the
 * full value on tap. Pass only the identifiers a surface has — empties render
 * as placeholder chips so the row stays aligned.
 *
 * Keeping this in one place is the point: the phone display and the desktop
 * table can't drift because they render the same component.
 */
export interface ReceivingIdentityChipsProps {
  po?: string | null;
  sku?: string | null;
  tracking?: string | null;
  /** Comma-joined serial list; SerialChip picks the most recent + last-4. */
  serialsCsv?: string | null;
  /** When set, derives pickup vs shipped tracking display from the row. */
  row?: ReceivingLineRow | null;
  includePo?: boolean;
  includeSku?: boolean;
  includeTracking?: boolean;
  includeSerial?: boolean;
  /**
   * Desktop table mode: lay the chips out as fixed-width {@link ChipColumns} so
   * PO / SKU / tracking / serial line up vertically across rows and the trailing
   * chip is flush with the day-group count. Left off (default) the chips render
   * as a free-flowing wrap row — used by the mobile receiving detail headers.
   */
  asColumns?: boolean;
  /** Wrapper layout classes for the free-flow (non-columns) layout. */
  className?: string;
  /** Smaller chip font + narrower columns — keeps all chips on one line on mobile rows. */
  dense?: boolean;
  /**
   * Replaces the tracking chip when there's no tracking value — used by the
   * Incoming view to host the "Add tracking" popover trigger in the otherwise
   * empty tracking slot. Ignored when a tracking value is present or row is pickup.
   */
  trackingAction?: React.ReactNode;
}

export function ReceivingIdentityChips({
  po,
  sku,
  tracking,
  serialsCsv,
  row = null,
  includePo = true,
  includeSku = true,
  includeTracking = true,
  includeSerial = true,
  asColumns = false,
  className = 'flex flex-wrap items-center gap-1.5',
  dense = false,
  trackingAction,
}: ReceivingIdentityChipsProps) {
  const poValue = (po || '').trim();
  const skuValue = (sku || '').trim();
  const isPickup = row ? isLocalPickupFulfillment(row) : false;
  const pickupLabel = row ? fulfillmentModeLabel(row) : null;
  const trackingValue = row
    ? (displayTrackingNumber(row) ?? '')
    : (tracking || '').trim();
  // The empty tracking slot can host an action (Incoming "Add tracking") instead
  // of the placeholder chip — only when there's genuinely no tracking value.
  const trackingNode =
    isPickup && pickupLabel
      ? <FulfillmentPickupPill dense={dense} />
      : !trackingValue && trackingAction
        ? trackingAction
        : null;
  const serialsValue = (serialsCsv || '').trim();
  // Dense columns are ~12px narrower so the full PO·SKU·tracking·serial set
  // stays on one line in a phone row.
  const idCol = dense ? 'w-[52px]' : CHIP_COL.id;
  const trackCol = dense ? 'w-[52px]' : CHIP_COL.tracking;
  const serialCol = dense ? 'w-[52px]' : CHIP_COL.serial;

  const trackingDisplay = trackingValue.length >= 8 ? getLast8(trackingValue) : getLast4(trackingValue);
  if (asColumns) {
    const columns: ChipColumn[] = [];
    if (includePo) {
      columns.push({ key: 'po', width: idCol, node: <OrderIdChip value={poValue} display={getLast4(poValue)} dense={dense} /> });
    }
    if (includeSku) {
      columns.push({ key: 'sku', width: idCol, node: <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} dense={dense} /> });
    }
    if (includeTracking) {
      columns.push({
        key: 'tracking',
        width: trackCol,
        node:
          trackingNode ??
          (isPickup ? null : <TrackingChip value={trackingValue} display={trackingDisplay} dense={dense} />),
      });
    }
    if (includeSerial) {
      columns.push({ key: 'serial', width: serialCol, node: <SerialChip value={serialsValue} width="w-fit max-w-full" dense={dense} /> });
    }
    return <ChipColumns columns={columns} />;
  }

  return (
    <div className={className}>
      {includePo && <OrderIdChip value={poValue} display={getLast4(poValue)} dense={dense} />}
      {includeSku && <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} dense={dense} />}
      {includeTracking &&
        (trackingNode ??
          (!isPickup ? <TrackingChip value={trackingValue} display={trackingDisplay} dense={dense} /> : null))}
      {includeSerial && <SerialChip value={serialsValue} dense={dense} />}
    </div>
  );
}
