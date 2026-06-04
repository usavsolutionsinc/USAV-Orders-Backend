'use client';

import {
  OrderIdChip,
  SkuScanRefChip,
  TrackingChip,
  SerialChip,
  getLast4,
  getLast4Serial,
} from '@/components/ui/CopyChip';

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
   * Right-align the trailing SerialChip's icon + value inside its fixed-width
   * box. The desktop receiving table sets this so the last chip hugs the right
   * edge (flush with the day-group count) while keeping the column a stable
   * width — so the PO / SKU / tracking chips don't shift between rows that have
   * a serial and rows that don't. Mobile detail headers leave it left-aligned.
   */
  alignSerialEnd?: boolean;
  /** Wrapper layout classes — desktop passes its grid class, mobile a wrap row. */
  className?: string;
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
  alignSerialEnd = false,
  className = 'flex flex-wrap items-center gap-1.5',
}: ReceivingIdentityChipsProps) {
  const poValue = (po || '').trim();
  const skuValue = (sku || '').trim();
  const trackingValue = (tracking || '').trim();
  const serialsValue = (serialsCsv || '').trim();

  return (
    <div className={className}>
      {includePo && <OrderIdChip value={poValue} display={getLast4(poValue)} />}
      {includeSku && <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />}
      {includeTracking && <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />}
      {includeSerial && (
        <SerialChip
          value={serialsValue}
          display={getLast4Serial(serialsValue)}
          align={alignSerialEnd ? 'end' : 'start'}
        />
      )}
    </div>
  );
}

export default ReceivingIdentityChips;
