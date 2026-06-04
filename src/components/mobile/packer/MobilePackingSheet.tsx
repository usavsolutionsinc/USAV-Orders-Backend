'use client';

import Link from 'next/link';
import { Camera } from '@/components/Icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import {
  OrderIdChip,
  SkuScanRefChip,
  TrackingChip,
  SerialChip,
  getLast4,
} from '@/components/ui/CopyChip';
import type { PackerLogRow } from '@/components/mobile/packer/types';

interface MobilePackingSheetProps {
  row: PackerLogRow | null;
  open: boolean;
  onClose: () => void;
}

function getSourceDotBg(row: PackerLogRow) {
  const trackingType = String(row.tracking_type || '').toUpperCase();
  if (trackingType === 'FNSKU' || row.fnsku) return 'bg-purple-500';
  if (trackingType === 'SKU') return 'bg-yellow-500';
  if (trackingType === 'ORDERS') return 'bg-blue-500';
  return 'bg-emerald-500';
}

/**
 * Phone-tuned sheet for a single packer log entry. Header mirrors the mobile
 * receiving carton sheet: title + qty/condition on the left, copy chips on
 * the right. Shows existing pack photos via PhotoGallery, with a CTA that
 * hands off to /m/p/{packerLogId}/photos for fresh captures.
 */
export function MobilePackingSheet({ row, open, onClose }: MobilePackingSheetProps) {
  if (!row) return null;

  const packerLogId = row.packer_log_id;
  const productTitle = row.product_title || row.item_number || row.sku || 'Unnamed pack line';
  const quantity = parseInt(String(row.quantity || '1'), 10) || 1;
  const orderId = (row.order_id || '').trim();
  const skuValue = (row.sku || '').trim();
  const trackingValue = (row.shipping_tracking_number || row.scan_ref || '').trim();
  const serialValue = (row.serial_number || '').trim();
  const photos = Array.isArray(row.packer_photos_url) ? row.packer_photos_url : [];

  const photosHref = packerLogId ? `/m/p/${packerLogId}/photos` : null;

  return (
    <BottomSheet open={open} onClose={onClose} maxWidth="32rem">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${getSourceDotBg(row)}`} />
            <div className="line-clamp-2 text-sm font-bold text-gray-900">
              {productTitle}
            </div>
          </div>

          <div className="flex items-center gap-2 pl-4">
            <span className="shrink-0 text-caption font-black uppercase tracking-widest">
              <span className={quantity > 1 ? 'text-yellow-600' : 'text-gray-700'}>
                {quantity}
              </span>
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <OrderIdChip value={orderId} display={getLast4(orderId)} />
              <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
              <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
              <SerialChip value={serialValue} />
            </div>
          </div>
        </div>

        {photos.length > 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
            <PhotoGallery photos={photos} orderId={orderId} compact launcherTitle={`${photos.length} pack photo${photos.length === 1 ? '' : 's'}`} />
          </div>
        ) : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-caption font-semibold text-amber-700">
            No pack photos yet — tap below to capture.
          </p>
        )}

        {photosHref ? (
          <Link
            href={photosHref}
            prefetch={false}
            onClick={onClose}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 text-white shadow-sm transition-colors active:bg-blue-700"
          >
            <Camera className="h-6 w-6" />
            <span className="text-sm font-black uppercase tracking-[0.18em]">
              Take Photos
            </span>
          </Link>
        ) : (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-center text-caption font-semibold text-rose-700">
            Missing packer log id — cannot attach photos.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
