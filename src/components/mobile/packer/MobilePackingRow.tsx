'use client';

import Link from 'next/link';
import { Camera } from '@/components/Icons';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import type { PackerLogRow } from '@/components/mobile/packer/types';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';

interface MobilePackingRowProps {
  row: PackerLogRow;
  variant: 'collapsed' | 'expanded';
  fresh?: boolean;
  onTap: () => void;
  photosHref: string;
}

function getSourceDotBg(row: PackerLogRow): string {
  const trackingType = String(row.tracking_type || '').toUpperCase();
  if (trackingType === 'FNSKU' || row.fnsku) return 'bg-purple-500';
  if (trackingType === 'SKU') return 'bg-yellow-500';
  if (trackingType === 'ORDERS') return 'bg-blue-500';
  return 'bg-emerald-500';
}

/**
 * Mobile packing row — the same display as {@link MobileReceivingRow}: shared
 * RowTitle + RowMetaColumns + ReceivingIdentityChips primitives, a compact
 * photo chip on collapsed rows, and a big "Take Photos" CTA on the bottom-pinned
 * expanded card. Packing carries no SKU/serial chip — order # + tracking only.
 */
export function MobilePackingRow({ row, variant, fresh = false, onTap, photosHref }: MobilePackingRowProps) {
  const productTitle = row.product_title || row.item_number || row.sku || 'Unnamed pack line';
  const quantity = parseInt(String(row.quantity || '1'), 10) || 1;
  const orderId = (row.order_id || '').trim();
  const trackingValue = (row.shipping_tracking_number || row.scan_ref || '').trim();
  const conditionLabel = (row.condition || '').trim().toUpperCase() || 'N/A';
  const condColor =
    conditionLabel === 'BRAND_NEW' || conditionLabel === 'BRAND NEW'
      ? 'text-yellow-600'
      : conditionLabel === 'PARTS'
        ? 'text-amber-800'
        : 'text-gray-500';
  const photoCount = Array.isArray(row.packer_photos_url) ? row.packer_photos_url.length : 0;
  const isExpanded = variant === 'expanded';

  return (
    <MobileRowCard variant={variant} fresh={fresh} onTap={onTap} dataAttr={{ name: 'packer-row-id', value: row.id }}>
      <RowTitle dot={getSourceDotBg(row)} dotTrack={META_COL.dotTrackWide} title={productTitle} />

      <div className="pointer-events-auto mt-0.5 flex items-center gap-2">
        <RowMetaColumns
          className="!mt-0 shrink-0"
          indent={META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={<span className={quantity > 1 ? 'text-yellow-600' : 'text-gray-900'}>{quantity}</span>}
          condition={<span className={condColor}>{conditionLabel}</span>}
        />
        <div className="ml-auto min-w-0">
          <ReceivingIdentityChips po={orderId} tracking={trackingValue} includeSku={false} includeSerial={false} asColumns dense />
        </div>
      </div>

      {isExpanded && (
        <Link
          href={photosHref}
          prefetch={false}
          aria-label="Take photos"
          className="pointer-events-auto mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-label font-black uppercase tracking-[0.18em] shadow-[0_6px_14px_-6px_rgba(37,99,235,0.55)] transition-transform active:scale-[0.98] active:bg-blue-700"
        >
          <Camera className="h-4 w-4" />
          <span>Take Photos</span>
          <span className="ml-1 tabular-nums text-white">x{photoCount}</span>
        </Link>
      )}
    </MobileRowCard>
  );
}
