'use client';

import Link from 'next/link';
import { Camera, Package, PackageCheck, Box, AlertCircle, Loader2 } from '@/components/Icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import {
  OrderIdChip,
  TrackingChip,
  SerialChip,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';
import { conditionGradeTableLabel, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

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

function getStatusIcon(status: string | null | undefined, className: string) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return <Box className={`${className} text-amber-500`} />;
  if (value === 'ARRIVED' || value === 'MATCHED') return <Package className={`${className} text-blue-500`} />;
  if (value === 'UNBOXED') return <Box className={`${className} text-indigo-500`} />;
  if (value === 'AWAITING_TEST' || value === 'IN_TEST') return <Loader2 className={`${className} text-violet-500`} />;
  if (value === 'PASSED' || value === 'DONE' || value === 'RECEIVED') return <PackageCheck className={`${className} text-emerald-500`} />;
  if (value.startsWith('FAILED') || value === 'SCRAP' || value === 'RTV') return <AlertCircle className={`${className} text-rose-500`} />;
  return <Package className={`${className} text-gray-400`} />;
}

/**
 * Phone-tuned sheet for a single receiving line. Mobile is photo-only — no
 * editor fields, no form. Header mirrors the desktop ReceivingLinesTable row:
 * title + qty • condition • workflow on the left, copy chips stacked on the
 * right. ReceivingPhotoStrip shows what's already captured, the CTA hands off
 * to the dedicated camera route at /m/r/{id}/photos.
 */
export function MobileCartonSheet({ row, staffId, open, onClose }: MobileCartonSheetProps) {
  if (!row) return null;

  const receivingId = row.receiving_id;
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const trackingValue = (row.tracking_number || '').trim();
  const qtyExpected = row.quantity_expected ?? 0;
  const qtyReceived = row.quantity_received;
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

  const photosHref = receivingId ? `/m/r/${receivingId}/photos` : null;

  return (
    <BottomSheet open={open} onClose={onClose} maxWidth="32rem">
      <div className="flex flex-col gap-4">
        {/* Header — mirrors desktop ReceivingLinesTable OrderRow: title + meta
            on the left, copy chips column on the right. */}
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status, qtyReceived, row.quantity_expected)}`}
              title={workflowLabel}
            />
            <div className="line-clamp-2 text-[14px] font-bold text-gray-900">
              {productTitle}
            </div>
          </div>

          <div className="flex items-center gap-2 pl-4">
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-black uppercase tracking-widest">
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
              <span className="text-gray-400">•</span>
              <span title={workflowLabel} className="inline-flex items-center">
                {getStatusIcon(row.workflow_status, 'h-3.5 w-3.5')}
              </span>
              {row.needs_test ? <span className="ml-2 text-orange-600">NEEDS TEST</span> : null}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <OrderIdChip value={poValue} display={getLast4(poValue)} />
              <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
              <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
            </div>
          </div>
        </div>

        {/* Existing photos */}
        {receivingId ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
            <ReceivingPhotoStrip receivingId={receivingId} staffId={staffId} />
          </div>
        ) : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-[11px] font-semibold text-amber-700">
            No package id yet — scan tracking from desktop first.
          </p>
        )}

        {/* Primary CTA — hands off to dedicated capture surface */}
        {photosHref ? (
          <Link
            href={photosHref}
            prefetch={false}
            onClick={onClose}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 text-white shadow-sm transition-colors active:bg-blue-700"
          >
            <Camera className="h-6 w-6" />
            <span className="text-[13px] font-black uppercase tracking-[0.18em]">
              Take Photos
            </span>
          </Link>
        ) : null}
      </div>
    </BottomSheet>
  );
}
