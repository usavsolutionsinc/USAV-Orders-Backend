'use client';

import Link from 'next/link';
import { Camera } from '@/components/Icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { MobileReceivingPhotoStrip } from '@/components/mobile/receiving/MobileReceivingPhotoStrip';
import {
  OrderIdChip,
  TrackingChip,
  SerialChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { conditionGradeTableLabel, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

interface MobileCartonSheetProps {
  row: ReceivingLineRow | null;
  staffId: number;
  open: boolean;
  onClose: () => void;
}

function getStatusDotBg(
  status: string | null | undefined,
  qtyReceived?: number,
  qtyExpected?: number | null,
) {
  if (
    qtyExpected != null &&
    qtyExpected > 0 &&
    qtyReceived != null &&
    qtyReceived >= qtyExpected
  ) {
    return 'bg-emerald-500';
  }
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return 'bg-amber-400';
  if (value === 'ARRIVED' || value === 'MATCHED') return 'bg-blue-500';
  if (value === 'UNBOXED') return 'bg-indigo-500';
  if (value === 'AWAITING_TEST' || value === 'IN_TEST') return 'bg-violet-500';
  if (value === 'PASSED' || value === 'DONE') return 'bg-emerald-500';
  if (value.startsWith('FAILED') || value === 'SCRAP' || value === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

/**
 * Phone-tuned sheet for a single receiving line. Mobile is photo-only — no
 * editor fields, no form. Header mirrors {@link MobileReceivingRow}: title +
 * qty • condition on the left (workflow icon suppressed on history/unbox feed),
 * copy chips stacked on the right. {@link MobileReceivingPhotoStrip} shows all
 * captured thumbs plus a camera xN badge; tapping opens the shared swipe viewer.
 * The CTA hands off to the dedicated camera route at /m/r/{id}/photos.
 */
export function MobileCartonSheet({ row, staffId, open, onClose }: MobileCartonSheetProps) {
  if (!row) return null;

  const receivingId = row.receiving_id;
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const trackingValue = (row.tracking_number || '').trim();
  const qtyExpected = row.quantity_expected ?? 0;
  const qtyReceived = row.quantity_received;
  const photoCount = row.photo_count ?? 0;
  const quantityText = `${qtyReceived}/${row.quantity_expected ?? '?'}`;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionColor =
    condGrade === 'BRAND_NEW'
      ? 'text-yellow-600'
      : condGrade === 'PARTS'
        ? 'text-amber-800'
        : 'text-gray-500';
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  // Title shown in the camera header — same precedence as the receiving rail
  // (RecentActivityRailBase), so unmatched cartons read "Unfound PO" and matched
  // lines read their item title. poValue names the saved NAS file by PO#.
  const cameraTitle = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const photosHref = receivingId
    ? `/m/r/${receivingId}/photos?title=${encodeURIComponent(cameraTitle)}${
        poValue ? `&poRef=${encodeURIComponent(poValue)}` : ''
      }`
    : null;
  const galleryHref = receivingId
    ? `/m/r/${receivingId}/gallery?title=${encodeURIComponent(cameraTitle)}${
        poValue ? `&poRef=${encodeURIComponent(poValue)}` : ''
      }&back=${encodeURIComponent('/m/receiving')}`
    : null;

  return (
    <BottomSheet open={open} onClose={onClose} maxWidth="32rem">
      <div className="flex flex-col gap-4">
        {/* Header — mirrors MobileReceivingRow: title + meta on the left, chips on the right. */}
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status, qtyReceived, row.quantity_expected)}`}
              title={workflowLabel}
            />
            <div className="line-clamp-2 text-sm font-bold text-gray-900">
              {productTitle}
            </div>
          </div>

          <div className="flex items-center gap-2 pl-4">
            <span className="flex shrink-0 items-center gap-1 text-caption font-black uppercase tracking-widest">
              <span
                className={
                  qtyExpected > 1 && qtyReceived < qtyExpected
                    ? 'text-yellow-600'
                    : row.quantity_expected && qtyReceived >= row.quantity_expected
                      ? 'text-emerald-600'
                      : 'text-gray-700'
                }
              >
                {quantityText}
              </span>
              <span className="text-gray-400">•</span>
              <span className={conditionColor}>{conditionLabel}</span>
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <OrderIdChip value={poValue} display={getLast4(poValue)} />
              <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
              <SerialChip value={serialsCsv} />
            </div>
          </div>
        </div>

        {/* Existing photos */}
        {receivingId && galleryHref ? (
          <MobileReceivingPhotoStrip
            receivingId={receivingId}
            staffId={staffId}
            galleryHref={galleryHref}
            countHint={photoCount}
            onNavigate={onClose}
          />
        ) : receivingId ? null : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-caption font-semibold text-amber-700">
            No package id yet — scan tracking from desktop first.
          </p>
        )}

        {/* Primary CTA — hands off to dedicated capture surface */}
        {photosHref ? (
          <Link
            href={photosHref}
            prefetch={false}
            onClick={onClose}
            aria-label={`Take photos (${photoCount} so far)`}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-white shadow-sm transition-colors active:bg-blue-700"
          >
            <Camera className="h-6 w-6" />
            <span className="text-base font-black tabular-nums">x{photoCount}</span>
          </Link>
        ) : null}
      </div>
    </BottomSheet>
  );
}
