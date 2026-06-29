'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Camera, ChevronDown, Image as ImageIcon } from '@/components/Icons';
import { getStatusDotBg, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import { ConditionGradeChip, UnitPriceChip } from '@/components/ui/CopyChip';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { MobileRowPhotoActions } from '@/components/mobile/receiving/MobileRowPhotoActions';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { buildUnitFields, unitTitle } from '@/components/mobile/receiving/receiving-feed-entries';

/**
 * Force a chip cluster's mono value to the meta-row qty size (`text-base`).
 * CopyChip hard-codes its value span to `text-sm`/`text-caption`; the descendant
 * selector outspecifies that without touching the shared primitive.
 */
const CHIP_SCALE = '[&_span]:text-base';

export interface MobileReceivingUnitRowProps {
  row: ReceivingLineRow;
  /** One-shot tint when the line just landed in the feed. */
  fresh?: boolean;
  /**
   * Only the bottom-most (newest) row in the whole feed is expanded — it gets
   * the big photo tile + full-width camera as a third row. Every other row is
   * compact: the gallery + camera live as small icons at the meta row's far
   * right, regardless of whether photos exist.
   */
  expanded?: boolean;
  /**
   * True for items inside a package: PO + tracking live once on the package
   * header, so they're omitted from this row's detail chips to avoid duplication.
   */
  headerSharesPoTracking?: boolean;
  captureHref: string;
  galleryHref: string;
  /** Opens the in-place swipe viewer (preferred on /m/receiving). */
  onOpenGallery?: () => void;
  /** Optional: open the richer carton sheet (wired to the title). */
  onOpenSheet?: () => void;
}

/**
 * Photo-first receiving item row — the per-unit body shared by the package group
 * and the standalone card.
 *
 * - **Expanded** (newest row only): title · meta row · a big photo row (gallery
 *   tile as status + full-width camera).
 * - **Compact** (everything else): title · meta row whose far right holds small
 *   gallery + camera icons (priority placement); no third row.
 *
 * All identifiers render through the shared CopyChip family (last-4 + copy on
 * tap), never as raw text. Tapping the dot/qty or the chevron toggles the
 * config-driven detail panel.
 */
export function MobileReceivingUnitRow({
  row,
  fresh = false,
  expanded = false,
  headerSharesPoTracking = false,
  captureHref,
  galleryHref,
  onOpenGallery,
  onOpenSheet,
}: MobileReceivingUnitRowProps) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);

  const title = unitTitle(row);
  const qtyExpected = row.quantity_expected ?? 0;
  const qtyText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyColor =
    qtyExpected > 1
      ? 'text-yellow-600'
      : row.quantity_expected && row.quantity_received >= row.quantity_expected
        ? 'text-emerald-600'
        : 'text-gray-500';

  const dot = getStatusDotBg(row.workflow_status, row.quantity_received, row.quantity_expected);
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');

  const photoCount = Math.max(0, row.photo_count ?? 0);
  const hasPhotos = photoCount > 0;

  const price = (row.unit_price || '').toString().trim();
  const detailFields = buildUnitFields(row);
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={`-mx-1 rounded-lg px-1 transition-colors duration-700 ${
        fresh ? 'bg-blue-50/60' : 'bg-transparent'
      }`}
    >
      {/* Title — opens the richer carton sheet when wired. */}
      <button
        type="button"
        onClick={onOpenSheet}
        disabled={!onOpenSheet}
        className="ds-raw-button block w-full text-left disabled:cursor-default"
      >
        <p className="text-base font-bold leading-snug text-gray-900">{title}</p>
      </button>

      {/* Meta row. */}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="ds-raw-button flex shrink-0 items-center gap-2 text-left"
        >
          <HoverTooltip label={workflowLabel} asChild focusable={false}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          </HoverTooltip>
          <span className={`shrink-0 text-base font-bold tabular-nums ${qtyColor}`}>{qtyText}</span>
        </button>

        {/* Main row shows ONLY the price (sized to match the qty). SKU + condition
            move to the "more information" dropdown so the gallery/camera actions
            keep their right-edge slot and never get pushed off the row. */}
        {price ? (
          <div className={`flex shrink-0 items-center ${CHIP_SCALE}`}>
            <UnitPriceChip amount={price} />
          </div>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Expand chevron sits LEFT of the gallery/camera; photo actions stay
              right-most for priority. */}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
            className="ds-raw-button inline-flex h-7 w-7 items-center justify-center text-gray-400"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {!expanded ? (
            <MobileRowPhotoActions
              photoCount={photoCount}
              galleryHref={galleryHref}
              captureHref={captureHref}
              onOpenGallery={onOpenGallery}
            />
          ) : null}
        </div>
      </div>

      {/* Detail panel — identifiers as CopyChips + config-driven text fields. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'mt-2 grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* The "more information" cluster: SKU + condition (moved off the main
              row) plus PO + tracking + serial. PO + tracking are omitted for
              package items (shown once on the package header) so nothing dupes. */}
          <div className={`flex flex-wrap items-center gap-2 px-0.5 pb-1 ${CHIP_SCALE}`}>
            <ReceivingIdentityChips
              includeSku
              includePo={!headerSharesPoTracking}
              includeTracking={!headerSharesPoTracking}
              sku={row.sku}
              po={row.zoho_purchaseorder_number || row.zoho_purchaseorder_id}
              tracking={row.tracking_number}
              serialsCsv={serialsCsv}
              className="flex flex-wrap items-center gap-2"
            />
            <ConditionGradeChip grade={row.condition_grade} />
          </div>
          {detailFields.length ? (
            <dl className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-gray-50/60">
              {detailFields.map((f) => (
                <div key={f.k} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <dt className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{f.k}</dt>
                  <dd className="min-w-0 truncate text-caption font-semibold text-gray-700">{f.v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      {/* Photo row — expanded (newest) only: gallery tile (status) + full-width camera. */}
      {expanded ? (
        <div className="mt-3 flex h-16 gap-2">
          {onOpenGallery ? (
            <button
              type="button"
              onClick={onOpenGallery}
              aria-label={hasPhotos ? `View ${photoCount} photos` : 'No photos yet'}
              className={
                hasPhotos
                  ? 'ds-raw-button inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 active:bg-blue-100'
                  : 'ds-raw-button inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-300'
              }
            >
              <span className="inline-flex items-center gap-1.5 leading-none">
                <ImageIcon className="h-7 w-7" />
                <span className="text-xl font-black tabular-nums">{photoCount}</span>
              </span>
            </button>
          ) : (
            <Link
              href={galleryHref}
              prefetch={false}
              aria-label={hasPhotos ? `View ${photoCount} photos` : 'No photos yet'}
              className={
                hasPhotos
                  ? 'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 active:bg-blue-100'
                  : 'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-300'
              }
            >
              <span className="inline-flex items-center gap-1.5 leading-none">
                <ImageIcon className="h-7 w-7" />
                <span className="text-xl font-black tabular-nums">{photoCount}</span>
              </span>
            </Link>
          )}
          <Link
            href={captureHref}
            prefetch={false}
            aria-label={`Take photos${photoCount > 0 ? ` (${photoCount} so far)` : ''}`}
            className="inline-flex h-16 min-w-0 flex-1 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_6px_14px_-6px_rgba(37,99,235,0.55)] transition-transform active:scale-[0.99] active:bg-blue-700"
          >
            <Camera className="h-7 w-7" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
