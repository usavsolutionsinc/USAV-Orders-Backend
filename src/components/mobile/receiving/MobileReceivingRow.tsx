'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import {
  OrderIdChip,
  SkuScanRefChip,
  TrackingChip,
  SerialChip,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';
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

function PhotoChip({ count, isAction = false }: { count: number; isAction?: boolean }) {
  const has = count > 0;
  return (
    <div
      className={`inline-flex w-[60px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums tracking-wide transition-transform ${
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
 * Mobile receiving row — single source for both the slim "older" row variant
 * and the bottom-pinned "most recent" expanded card. 
 * 
 * Optimized for a strict two-row display matching the requested UI:
 * Row 1: Status Dot + Product Title
 * Row 2: [Qty 1/1] [PO Chip] [SKU Chip] [Tracking Chip] ... [Photo Action]
 */
export function MobileReceivingRow({ row, variant, fresh = false, onTap, photosHref }: MobileReceivingRowProps) {
  const reduceMotion = useReducedMotion();
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const skuValue = (row.sku || '').trim();
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
  const photoCount = row.photo_count ?? 0;
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  const isExpanded = variant === 'expanded';

  return (
    <div
      data-line-row-id={row.id}
      className={`relative transition-all ${
        isExpanded 
          ? 'mx-3 mb-3 mt-2 rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]' 
          : 'flex w-full flex-col border-b border-gray-100 px-3 py-3 active:bg-blue-50 bg-white transition-colors'
      }`}
    >
      {/* Tap area for the sheet overlay */}
      <button 
        type="button" 
        onClick={onTap} 
        className="absolute inset-0 z-0 h-full w-full active:bg-blue-50/30" 
      />

      {/* Fresh-arrival ring pulse (only for expanded) */}
      {isExpanded && fresh && !reduceMotion && (
        <motion.span
          aria-hidden
          initial={{ opacity: 0.55, scale: 1 }}
          animate={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute inset-0 z-0 rounded-2xl ring-2 ring-blue-400/70"
        />
      )}

      {/* Content Layer */}
      <div className="relative z-10 pointer-events-none flex flex-col">
        {/* Row 1: Status Dot + Product Title */}
        <div className="flex items-center gap-3">
          <span
            className={`${isExpanded ? 'h-2.5 w-2.5' : 'h-2 w-2'} shrink-0 rounded-full ${getStatusDotBg(row.workflow_status)}`}
            title={workflowLabel}
          />
          <span className={`min-w-0 flex-1 truncate font-bold text-gray-900 ${isExpanded ? 'text-[15px] tracking-tight' : 'text-[13px]'}`}>
            {productTitle}
          </span>
        </div>

        {/* Row 2: meta on the left, chips pushed right, photo icon pinned far right */}
        <div className="mt-3 flex items-center gap-2">
          <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap font-black uppercase tracking-widest ${isExpanded ? 'text-[11px]' : 'text-[10px]'}`}>
            <span
              className={
                qtyExpected > 1 && qtyReceived < qtyExpected
                  ? 'text-yellow-600'
                  : row.quantity_expected && qtyReceived >= row.quantity_expected
                    ? 'text-emerald-600'
                    : 'text-gray-900'
              }
            >
              {quantityText}
            </span>
            <span className="text-gray-400">•</span>
            <span className={conditionColor}>{conditionLabel}</span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500">{workflowLabel}</span>
          </span>

          <div className="ml-auto flex min-w-0 items-center gap-2 pointer-events-auto">
            {poValue && <OrderIdChip value={poValue} display={getLast4(poValue)} />}
            {skuValue && <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />}
            {trackingValue && <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />}
            <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
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
      </div>
    </div>
  );
}
