'use client';

import Link from 'next/link';
import { Camera, Image as ImageIcon } from '@/components/Icons';
import {
  conditionGradeTableLabel,
  workflowStatusTableLabel,
  getStatusDotBg,
  getWorkflowIconMeta,
  shouldShowWorkflowStatusIcon,
  type ReceivingRowDisplay,
} from '@/components/station/receiving-constants';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { MobileRowPhotoActions } from '@/components/mobile/receiving/MobileRowPhotoActions';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { MobileRowCard } from '@/components/mobile/feed/MobileRowCard';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface MobileReceivingRowProps {
  row: ReceivingLineRow;
  variant: 'collapsed' | 'expanded';
  /** True for the first ~2s after the row first appears — drives a one-time ring/glow pulse. */
  fresh?: boolean;
  onTap: () => void;
  /** Capture route — dedicated camera surface. */
  captureHref: string;
  /** Gallery route — opens swipe viewer (`?mode=gallery`). */
  galleryHref: string;
  /** Opens the carton sheet + swipe viewer in place (preferred on `/m/receiving`). */
  onOpenGallery?: () => void;
  /**
   * Shared desktop⇄mobile display flags. The mobile receiving feed is the
   * recent/history surface, so it defaults to `{ isHistory: true }` — which
   * suppresses the workflow status icon exactly like the desktop history table.
   */
  display?: ReceivingRowDisplay;
}

/**
 * Mobile receiving row — the phone mirror of a {@link ReceivingLinesTable} row.
 * Uses the SAME primitives so the two can't drift: {@link RowTitle} (status dot
 * + product title), {@link RowMetaColumns} (qty · condition · workflow icon),
 * and {@link ReceivingIdentityChips} (PO / SKU / tracking / serial, always
 * rendered as fixed columns — empties read as '----'). The bottom-pinned
 * expanded card adds capture CTA; collapsed rows show gallery + camera buttons on
 * the right (gallery left, capture right).
 */
export function MobileReceivingRow({
  row,
  variant,
  fresh = false,
  onTap,
  captureHref,
  galleryHref,
  onOpenGallery,
  display = { isHistory: true },
}: MobileReceivingRowProps) {
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  // Icon mapping + show/hide are the SAME shared decision the desktop table uses.
  const { Icon: WorkflowIcon, tone: workflowIconTone } = getWorkflowIconMeta(workflowLabel);
  const showWorkflowIcon = shouldShowWorkflowStatusIcon(display);

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

      {/* Second row: qty · condition (left) + chips + photo actions (right). */}
      <div className="pointer-events-auto mt-0.5 flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
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
            showWorkflowIcon ? (
              <HoverTooltip label={workflowLabel} asChild>
                <span className="inline-flex items-center">
                  <WorkflowIcon className={`h-3.5 w-3.5 ${workflowIconTone}`} />
                </span>
              </HoverTooltip>
            ) : undefined
          }
        />
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
          <div className="min-w-0 overflow-hidden">
            <ReceivingIdentityChips po={poValue} sku={skuValue} tracking={trackingValue} serialsCsv={serialsCsv} asColumns dense />
          </div>
          {!isExpanded ? (
            <MobileRowPhotoActions
              photoCount={photoCount}
              galleryHref={galleryHref}
              captureHref={captureHref}
              onOpenGallery={onOpenGallery}
              className="shrink-0"
            />
          ) : null}
        </div>
      </div>

      {/* Bottom bar: fixed-width gallery + wide camera, same height. */}
      {isExpanded && (
        <div className="pointer-events-auto mt-3 flex h-14 gap-2">
          {onOpenGallery ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpenGallery();
              }}
              aria-label={photoCount > 0 ? `View ${photoCount} photos` : 'Open photo gallery'}
              className={
                photoCount > 0
                  ? 'ds-raw-button inline-flex h-full w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100'
                  : 'ds-raw-button inline-flex h-full w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100'
              }
            >
              <ImageIcon className="h-5 w-5" />
              {photoCount > 0 ? (
                <span className="text-micro font-black leading-none tabular-nums">x{photoCount}</span>
              ) : null}
            </button>
          ) : (
            <Link
              href={galleryHref}
              prefetch={false}
              aria-label={photoCount > 0 ? `View ${photoCount} photos` : 'Open photo gallery'}
              className={
                photoCount > 0
                  ? 'inline-flex h-full w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100'
                  : 'inline-flex h-full w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100'
              }
            >
              <ImageIcon className="h-5 w-5" />
              {photoCount > 0 ? (
                <span className="text-micro font-black leading-none tabular-nums">x{photoCount}</span>
              ) : null}
            </Link>
          )}
          <Link
            href={captureHref}
            prefetch={false}
            aria-label={`Take photos${photoCount > 0 ? ` (${photoCount} so far)` : ''}`}
            className="inline-flex h-full min-w-0 flex-1 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_6px_14px_-6px_rgba(37,99,235,0.55)] transition-transform active:scale-[0.98] active:bg-blue-700"
          >
            <Camera className="h-6 w-6" />
          </Link>
        </div>
      )}
    </MobileRowCard>
  );
}
