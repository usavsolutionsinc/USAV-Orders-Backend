'use client';

import Link from 'next/link';
import { Camera, Package, PackageCheck, Clock, Truck } from '@/components/Icons';
import {
  conditionGradeTableLabel,
  workflowStatusTableLabel,
  getStatusDotBg,
} from '@/components/station/receiving-constants';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';

interface MobileReceivingRowProps {
  row: ReceivingLineRow;
  variant: 'collapsed' | 'expanded';
  /** True for the first ~2s after the row first appears — drives a one-time ring/glow pulse. */
  fresh?: boolean;
  onTap: () => void;
  /** Path the camera FAB navigates to. Pre-built by parent so we can carry staffId, etc. */
  photosHref: string;
}

/**
 * Mobile receiving row — the phone mirror of a {@link ReceivingLinesTable} row.
 * Uses the SAME primitives so the two can't drift: {@link RowTitle} (status dot
 * + product title), {@link RowMetaColumns} (qty · condition · workflow icon),
 * and {@link ReceivingIdentityChips} (PO / SKU / tracking / serial, always
 * rendered as fixed columns — empties read as '----'). The bottom-pinned
 * expanded card adds a big "Take Photos" CTA; collapsed rows show a compact
 * photo-count chip.
 */
export function MobileReceivingRow({ row, variant, fresh = false, onTap, photosHref }: MobileReceivingRowProps) {
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const { WorkflowIcon, workflowIconTone } =
    workflowLabel === 'RECEIVED'
      ? { WorkflowIcon: PackageCheck, workflowIconTone: 'text-emerald-600' }
      : workflowLabel === 'EXPECTED'
        ? { WorkflowIcon: Clock, workflowIconTone: 'text-amber-500' }
        : workflowLabel === 'SCANNED'
          ? { WorkflowIcon: Truck, workflowIconTone: 'text-blue-600' }
          : { WorkflowIcon: Package, workflowIconTone: 'text-gray-400' };

  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const conditionColor =
    condGrade === 'BRAND_NEW' ? 'text-yellow-600' : condGrade === 'PARTS' ? 'text-amber-800' : 'text-gray-500';

  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').toString().trim();
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const serialsCsv = (row.serials ?? []).map((s) => (s.serial_number || '').trim()).filter(Boolean).join(', ');
  const photoCount = row.photo_count ?? 0;
  const isExpanded = variant === 'expanded';

  return (
    <MobileRowCard variant={variant} fresh={fresh} onTap={onTap} dataAttr={{ name: 'line-row-id', value: row.id }}>
      {/* Title — identical primitive to the desktop table row. */}
      <RowTitle
        dot={getStatusDotBg(row.workflow_status, row.quantity_received, row.quantity_expected)}
        dotTitle={workflowLabel}
        dotTrack={META_COL.dotTrackWide}
        title={productTitle}
      />

      {/* Second row: qty · condition · workflow icon (left) + identity chips
          (right, dense so all four columns stay on this one line). */}
      <div className="pointer-events-auto mt-0.5 flex items-center gap-2">
        <RowMetaColumns
          className="!mt-0 shrink-0"
          indent={META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={
            <span
              className={
                qtyExpected > 1
                  ? 'text-yellow-600'
                  : row.quantity_expected && row.quantity_received >= row.quantity_expected
                    ? 'text-emerald-600'
                    : 'text-gray-500'
              }
            >
              {quantityText}
            </span>
          }
          condition={<span className={conditionColor}>{conditionLabel}</span>}
          rest={
            <span title={workflowLabel} className="inline-flex items-center">
              <WorkflowIcon className={`h-3.5 w-3.5 ${workflowIconTone}`} />
            </span>
          }
        />
        <div className="ml-auto min-w-0">
          <ReceivingIdentityChips po={poValue} sku={skuValue} tracking={trackingValue} serialsCsv={serialsCsv} asColumns dense />
        </div>
      </div>

      {/* Bottom-pinned card: big Take Photos CTA. */}
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
