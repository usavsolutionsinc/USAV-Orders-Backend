'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Camera, Check } from '@/components/Icons';
import { conditionGradeTableLabel, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface MobileReceivingRowProps {
  row: ReceivingLineRow;
  variant: 'collapsed' | 'expanded';
  /** True for the first ~2s after the row first appears — drives a one-time ring/glow pulse. */
  fresh?: boolean;
  onTap: () => void;
  /** Path the camera FAB navigates to. Pre-built by parent so we can carry staffId, etc. */
  photosHref: string;
}

function getStatusDotBg(status: string | null | undefined) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return 'bg-amber-400';
  if (value === 'ARRIVED' || value === 'MATCHED') return 'bg-blue-500';
  if (value === 'UNBOXED') return 'bg-indigo-500';
  if (value === 'AWAITING_TEST' || value === 'IN_TEST') return 'bg-violet-500';
  if (value === 'PASSED' || value === 'DONE') return 'bg-emerald-500';
  if (value.startsWith('FAILED') || value === 'SCRAP' || value === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

function PhotoChip({ count }: { count: number }) {
  const has = count > 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-black tabular-nums tracking-wide ${
        has ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
      }`}
      aria-label={has ? `${count} photos captured` : 'no photos yet'}
    >
      <Camera className="h-3 w-3" />
      {has ? <Check className="h-3 w-3" /> : null}
      <span>{count}</span>
    </span>
  );
}

/**
 * Mobile receiving row — single source for both the slim "older" row variant
 * and the bottom-pinned "most recent" expanded card. Same data shape as the
 * desktop OrderRow but pared back to the fields a phone tech needs at a glance.
 */
export function MobileReceivingRow({ row, variant, fresh = false, onTap, photosHref }: MobileReceivingRowProps) {
  const reduceMotion = useReducedMotion();
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const trackingValue = (row.tracking_number || '').trim();
  const qtyExpected = row.quantity_expected ?? 0;
  const qtyReceived = row.quantity_received;
  const quantityText = `${qtyReceived}/${row.quantity_expected ?? '?'}`;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const photoCount = row.photo_count ?? 0;

  if (variant === 'collapsed') {
    return (
      <button
        type="button"
        onClick={onTap}
        data-line-row-id={row.id}
        className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left transition-colors active:bg-blue-50 ${
          fresh ? 'bg-blue-50/60' : 'bg-white'
        }`}
      >
        <PhotoChip count={photoCount} />
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status)}`}
          title={workflowLabel}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] font-bold text-gray-900">{productTitle}</span>
          <span className="truncate text-xs font-black uppercase tracking-widest text-gray-500">
            {poValue ? `${poValue} · ` : ''}
            <span
              className={
                qtyExpected > 1
                  ? 'text-yellow-600'
                  : row.quantity_expected && qtyReceived >= row.quantity_expected
                    ? 'text-emerald-600'
                    : 'text-gray-700'
              }
            >
              {quantityText}
            </span>
          </span>
        </div>
      </button>
    );
  }

  // expanded
  return (
    <div
      data-line-row-id={row.id}
      className="relative mx-3 mb-3 mt-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]"
    >
      {/* Fresh-arrival ring pulse — fades out on its own; no layout impact */}
      {fresh && !reduceMotion && (
        <motion.span
          aria-hidden
          initial={{ opacity: 0.55, scale: 1 }}
          animate={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-blue-400/70 shadow-[0_0_0_8px_rgba(96,165,250,0.18)]"
        />
      )}
      <button type="button" onClick={onTap} className="block w-full text-left">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status)}`}
            title={workflowLabel}
          />
          <span className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">
            Most recent
          </span>
          <span className="ml-auto">
            <PhotoChip count={photoCount} />
          </span>
        </div>

        <p className="mt-2 line-clamp-2 pr-12 text-[15px] font-black tracking-tight text-gray-900">
          {productTitle}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pr-12 text-xs font-black uppercase tracking-widest text-gray-500">
          {poValue ? <span className="text-gray-700">PO {poValue}</span> : null}
          <span
            className={
              qtyExpected > 1
                ? 'text-yellow-600'
                : row.quantity_expected && qtyReceived >= row.quantity_expected
                  ? 'text-emerald-600'
                  : 'text-gray-700'
            }
          >
            {quantityText}
          </span>
          <span className="text-gray-500">{conditionLabel}</span>
          <span className="text-gray-500">{workflowLabel}</span>
          {trackingValue ? (
            <span className="text-gray-400">· {trackingValue.slice(-6).toUpperCase()}</span>
          ) : null}
        </div>
      </button>

      <Link
        href={photosHref}
        prefetch={false}
        aria-label="Take photos for this carton"
        className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-transform active:scale-95"
      >
        <Camera className="h-5 w-5" />
      </Link>
    </div>
  );
}
