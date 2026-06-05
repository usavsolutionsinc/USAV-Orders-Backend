'use client';

import {
  OrderIdChip,
  SkuScanRefChip,
  TrackingChip,
  SerialChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';

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
}

export function ReceivingIdentityChips({
  po,
  sku,
  tracking,
  serialsCsv,
  includePo = true,
  includeSku = true,
  includeTracking = true,
  includeSerial = true,
  asColumns = false,
  className = 'flex flex-wrap items-center gap-1.5',
  dense = false,
}: ReceivingIdentityChipsProps) {
  const poValue = (po || '').trim();
  const skuValue = (sku || '').trim();
  const trackingValue = (tracking || '').trim();
  const serialsValue = (serialsCsv || '').trim();
  // Dense columns are ~12px narrower so the full PO·SKU·tracking·serial set
  // stays on one line in a phone row.
  const idCol = dense ? 'w-[52px]' : CHIP_COL.id;
  const trackCol = dense ? 'w-[52px]' : CHIP_COL.tracking;
  const serialCol = dense ? 'w-[52px]' : CHIP_COL.serial;

  if (asColumns) {
    const columns: ChipColumn[] = [];
    if (includePo) {
      columns.push({ key: 'po', width: idCol, node: <OrderIdChip value={poValue} display={getLast4(poValue)} dense={dense} /> });
    }
    if (includeSku) {
      columns.push({ key: 'sku', width: idCol, node: <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} dense={dense} /> });
    }
    if (includeTracking) {
      columns.push({ key: 'tracking', width: trackCol, node: <TrackingChip value={trackingValue} display={getLast4(trackingValue)} dense={dense} /> });
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
      {includeTracking && <TrackingChip value={trackingValue} display={getLast4(trackingValue)} dense={dense} />}
      {includeSerial && <SerialChip value={serialsValue} dense={dense} />}
    </div>
  );
}

export default ReceivingIdentityChips;
