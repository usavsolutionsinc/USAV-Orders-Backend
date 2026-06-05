'use client';

import Link from 'next/link';
import {
  OrderIdChip,
  TrackingChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { Camera, Check } from '@/components/Icons';
import type { PackerLogRow } from '@/components/mobile/packer/types';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';

interface MobilePackingRowProps {
  row: PackerLogRow;
  variant: 'collapsed' | 'expanded';
  fresh?: boolean;
  onTap: () => void;
  photosHref: string;
}

function getSourceDotBg(row: PackerLogRow) {
  const trackingType = String(row.tracking_type || '').toUpperCase();
  if (trackingType === 'FNSKU' || row.fnsku) return 'bg-purple-500';
  if (trackingType === 'SKU') return 'bg-yellow-500';
  if (trackingType === 'ORDERS') return 'bg-blue-500';
  return 'bg-emerald-500';
}

function PhotoChip({ count, isAction = false }: { count: number; isAction?: boolean }) {
  const has = count > 0;
  return (
    <div
      className={`inline-flex w-[60px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-caption font-black tabular-nums tracking-wide transition-transform ${
        isAction
          ? 'bg-blue-600 text-white shadow-sm active:scale-95'
          : has ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
      }`}
    >
      <Camera className="h-3.5 w-3.5" />
      {!isAction ? (
        <Check className={`h-2.5 w-2.5 ${has ? '' : 'invisible'}`} />
      ) : null}
      <span>{count}</span>
    </div>
  );
}

/**
 * Mobile packing row — mirrors MobileReceivingRow. Single source for both the
 * slim "older" rows and the bottom-pinned "most recent" expanded card.
 *
 * Layout:
 *   Row 1: source dot + product title
 *   Row 2: [qty • condition] ... [chips] [photo chip]
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
    <MobileRowCard
      variant={variant}
      fresh={fresh}
      onTap={onTap}
      dataAttr={{ name: 'packer-row-id', value: row.id }}
    >
        <div className="flex items-center gap-3">
          <span
            className={`${isExpanded ? 'h-2.5 w-2.5' : 'h-2 w-2'} shrink-0 rounded-full ${getSourceDotBg(row)}`}
          />
          <span className={`min-w-0 flex-1 truncate font-bold text-gray-900 ${isExpanded ? 'text-base tracking-tight' : 'text-sm'}`}>
            {productTitle}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap font-black uppercase tracking-widest ${isExpanded ? 'text-caption' : 'text-micro'}`}>
            <span className={quantity > 1 ? 'text-yellow-600' : 'text-gray-900'}>
              {quantity}
            </span>
            <span className="text-gray-400">•</span>
            <span className={condColor}>{conditionLabel}</span>
          </span>

          <div className="ml-auto flex min-w-0 items-center gap-2 pointer-events-auto">
            {orderId && <OrderIdChip value={orderId} display={getLast4(orderId)} />}
            {trackingValue && <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />}
          </div>

          <Link
            href={photosHref}
            prefetch={false}
            className="pointer-events-auto shrink-0"
            aria-label="Take photos"
          >
            <PhotoChip count={photoCount} isAction={isExpanded} />
          </Link>
        </div>
    </MobileRowCard>
  );
}
