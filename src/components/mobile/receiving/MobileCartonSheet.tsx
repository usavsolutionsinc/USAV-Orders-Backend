'use client';

import Link from 'next/link';
import { Camera } from '@/components/Icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ReceivingPhotoStrip } from '@/components/sidebar/ReceivingPhotoStrip';
import { conditionGradeTableLabel, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface MobileCartonSheetProps {
  row: ReceivingLineRow | null;
  staffId: number;
  open: boolean;
  onClose: () => void;
}

/**
 * Phone-tuned sheet for a single receiving line. Mobile is photo-only — no
 * editor fields, no form. Header summarizes the carton, ReceivingPhotoStrip
 * shows what's already captured, the CTA hands off to the dedicated camera
 * route at /m/r/{id}/photos.
 */
export function MobileCartonSheet({ row, staffId, open, onClose }: MobileCartonSheetProps) {
  if (!row) return null;

  const receivingId = row.receiving_id;
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const trackingValue = (row.tracking_number || '').trim();
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);

  const photosHref = receivingId ? `/m/r/${receivingId}/photos` : null;

  return (
    <BottomSheet open={open} onClose={onClose} maxWidth="32rem">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div>
          {poValue ? (
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">
              PO {poValue}
            </p>
          ) : null}
          <p className="mt-0.5 line-clamp-2 text-[15px] font-black tracking-tight text-gray-900">
            {productTitle}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <span className="text-gray-700">{quantityText}</span>
            <span>{conditionLabel}</span>
            <span>{workflowLabel}</span>
            {trackingValue ? (
              <span className="text-gray-400">· {trackingValue.slice(-6).toUpperCase()}</span>
            ) : null}
          </div>
        </div>

        {/* Existing photos */}
        {receivingId ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
            <ReceivingPhotoStrip receivingId={receivingId} staffId={staffId} />
          </div>
        ) : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-[11px] font-semibold text-amber-700">
            No carton id yet — scan tracking from desktop first.
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
