'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { Check, Link2 } from '@/components/Icons';
import { emitSelection, emitSelectionTotal, onToggleAll } from '@/lib/selection/table-selection';
import { SkeletonList } from '@/design-system/components/Skeletons';
import { conditionGradeTableLabel, workflowStatusTableLabel, getStatusDotBg, getWorkflowIconMeta, shouldShowWorkflowStatusIcon } from '@/components/station/receiving-constants';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { OrderIdChip, TrackingChip, SerialChip, SkuCountChip, SerialCountChip, getLast4, AddValueChipFace } from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { SOURCE_PLATFORM_LABELS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { CollapsibleGroupRow } from '@/components/ui/CollapsibleGroupRow';
import { groupRowsBy } from '@/lib/group-rows';
import { DeliveryStateIcon } from '@/components/station/ReceivingDeliveryStateIcon';
import { IconWithTooltip } from '@/components/ui/IconWithTooltip';
import WeekHeader from '@/components/ui/WeekHeader';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import type { IncomingDeliveryState } from '@/components/sidebar/receiving/IncomingSidebarPanel';
import { IncomingPaneHeader } from '@/components/sidebar/receiving/IncomingPaneHeader';
import { IncomingAttachTrackingPopover } from '@/components/sidebar/receiving/IncomingAttachTrackingPopover';
import {
  getReceivingModeDescriptor,
  historySortGroupAxis,
  INCOMING_PAGE_SIZE,
  type ReceivingModeContext,
} from '@/lib/receiving/receiving-modes';
import {
  computeWeekRange,
  toPSTDateKey,
} from '@/utils/date';
import {
  dashboardOrderRowChipsClass,
  dashboardOrderRowShellClass,
} from '@/lib/dashboard-order-row-layout';
import {
  RECEIVING_HISTORY_URL_PARAMS,
  normalizeReceivingHistorySearchField,
  normalizeReceivingHistorySearchScope,
} from '@/lib/receiving-history-search';

/**
 * Passed to `/api/receiving-lines` as `view`. Re-exported from the shared
 * contract so the server route and this client agree on the supported set.
 */
export type { ReceivingView } from '@/lib/receiving/receiving-views';

export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  tracking_number: string | null;
  tracking_source?: 'shipment' | 'receiving' | 'zoho_reference' | null;
  carrier: string | null;
  shipment_status?: string | null;
  is_delivered?: boolean;
  delivered_at?: string | null;
  zoho_item_id: string | null;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  item_name: string | null;
  /** The Zoho item's own title (items.name, canonical product SoT). ALWAYS preferred for display — the PO line's item_name is a listing-style per-receipt title, not the product title. Null only when the line has no Zoho item. */
  zoho_item_title?: string | null;
  /** Canonical Zoho catalog title (sku_catalog.product_title), joined by SKU. Prefer over item_name for display; null when the SKU isn't catalogued yet. */
  catalog_product_title?: string | null;
  /** Canonical sku_catalog.id for this line's SKU. Keys the SKU pairing surface; null when the SKU isn't catalogued yet. */
  sku_catalog_id?: number | null;
  sku: string | null;
  quantity_received: number;
  quantity_expected: number | null;
  qa_status: string;
  workflow_status: string | null;
  disposition_code: string;
  condition_grade: string;
  disposition_audit: unknown[];
  needs_test: boolean;
  assigned_tech_id: number | null;
  zoho_sync_source: string | null;
  zoho_last_modified_time: string | null;
  zoho_synced_at: string | null;
  receiving_type: string | null;
  /** Unfound-line intake classification (receiving_lines.intake_type): po | return | trade_in. Null on Zoho-matched lines. */
  intake_type?: string | null;
  /** Operator platform override on a manually-added unfound line (receiving_lines.source_platform_pill). Null on Zoho-matched lines. */
  source_platform_pill?: string | null;
  /**
   * Carton-level DEFAULT receiving type (receiving.intake_type): PO|RETURN|TRADE_IN.
   * The carton pill edits this; receiving_type above overrides per line.
   * Effective line type = receiving_type ?? carton_intake_type ?? 'PO'. Migration 2026-06-13b.
   */
  carton_intake_type?: string | null;
  notes: string | null;
  /** Carton-level support notes from `receiving.support_notes` (same for all lines on the package). */
  receiving_support_notes?: string | null;
  /** Carton-level listing URL from `receiving.listing_url` (same for all lines on the package). */
  receiving_listing_url?: string | null;
  /**
   * Derived faceted bucket for `view=incoming` — computed on read from the
   * carrier status on shipping_tracking_numbers (DELIVERED_UNOPENED,
   * ARRIVING_TODAY, STALLED, IN_TRANSIT, PENDING_CARRIER, AWAITING_TRACKING).
   * Null on other views.
   */
  delivery_state?:
    | 'DELIVERED_UNOPENED'
    | 'ARRIVING_TODAY'
    | 'STALLED'
    | 'IN_TRANSIT'
    | 'TRACKING_UNAVAILABLE'
    | 'PENDING_CARRIER'
    | 'CARRIER_MISMATCH'
    | 'AWAITING_TRACKING'
    | 'RECEIVED'
    | 'UNKNOWN'
    | null;
  /** Zoho PO date (`zoho_po_mirror.po_date`) — when the buyer authored the PO upstream (Incoming view only). */
  po_date?: string | null;
  /** Vendor-promised delivery date from zoho_po_mirror (Incoming view only). */
  expected_delivery_date?: string | null;
  /** Vendor name from zoho_po_mirror (Incoming view only). */
  vendor_name?: string | null;
  /**
   * Zoho PO mirror status (`zoho_po_mirror.status`) — incoming + scanned views.
   * Phase 2: when terminal (received/closed/billed/cancelled) the row is badged
   * "Zoho: received" instead of being hidden, so a physically-present box stays
   * actionable while the financial-state mismatch is visible.
   */
  zoho_status?: string | null;
  created_at: string | null;
  /** Last write to the line row itself (qty bump, condition, notes, …).
   *  Drives the unbox rail's sort + time label (sort=unbox_activity). */
  updated_at?: string | null;
  /** Most-recent scan/receive time. Server sorts view=recent/all by this. */
  last_activity_at?: string | null;
  /** Door-scan ("scanned at") timestamp — receiving.received_at (view=recent/all/received). */
  received_at?: string | null;
  /** Staff who recorded the door scan (receiving.received_by → staff.name). */
  received_by_name?: string | null;
  /** Unbox timestamp — receiving.unboxed_at; null until the carton is unboxed. */
  unboxed_at?: string | null;
  /** Terminal "Received" (DONE) transition time — receiving_lines.received_done_at;
   *  null until the line is fully received. Distinct from received_at (door scan). */
  received_done_at?: string | null;
  /** Staff who unboxed (receiving.unboxed_by → staff.name). */
  unboxed_by_name?: string | null;
  /** First tracking scan time (receiving_scans, earliest). */
  scanned_at?: string | null;
  /** Staff who first scanned the tracking (receiving_scans.scanned_by → staff.name). */
  scanned_by_name?: string | null;
  /**
   * Count of recorded testing verdicts for this line (view=testing only;
   * null on other views). Scoped to the tester when the feed is. Drives the
   * Testing rail's "tested k/N" without re-deriving from workflow_status.
   */
  tested_count?: number | null;
  image_url: string | null;
  source_platform: string | null;
  /** Shared unbox/test urgency flag (receiving.is_priority) — rank-0 in the Prioritize sort. */
  is_priority?: boolean | null;
  /** Manual priority-tier override (receiving.priority_tier): null = Auto, 0..3 = Priority/High/Medium/Low. */
  priority_tier?: number | null;
  /**
   * receiving.source — 'zoho_po' | 'unmatched' | 'local_pickup'.
   * Drives which workspace variant mounts (LineEditPanel vs UnfoundLineEditPanel).
   * Optional so callers that don't fetch from /api/receiving-lines still typecheck.
   */
  receiving_source?: string | null;
  /**
   * Saved serial_units for this line. `current_status` reflects the
   * unit's lifecycle position (RECEIVED → IN_TEST → TESTED / ON_HOLD …)
   * and drives the per-unit testing verdict pills in the tech workspace.
   */
  serials?: Array<{
    id: number;
    serial_number: string;
    current_status?: string;
    condition_grade?: string | null;
  }> | null;
  /** Count of photos attached to this line's carton (from photos table, entity_type='RECEIVING'). */
  photo_count?: number;
  /** Filed Zendesk ticket # for this line (receiving_lines.zendesk_ticket), stored as "#<id>". */
  zendesk_ticket?: string | null;
}

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
  limit: number;
  offset: number;
}

export function dispatchSelectLine(row: ReceivingLineRow | null) {
  window.dispatchEvent(new CustomEvent('receiving-select-line', { detail: row }));
}

/** Selection scope shared by the table, its header Select toggle, and the
 *  SelectionActionBar (see useTableSelection / SelectionActionBar). */
export const RECEIVING_SELECTION_SCOPE = 'receiving' as const;

export function dispatchLineUpdated(row: Partial<ReceivingLineRow> & { id: number }) {
  window.dispatchEvent(new CustomEvent('receiving-line-updated', { detail: row }));
}

/**
 * Activity timestamp the History feed groups + sorts by. Default ('scanned')
 * axis = the last scan/receive (`last_activity_at` — the same axis the Recent
 * rail orders by, per its "Same as History" label), falling back to created_at.
 * Grouping on created_at alone bucketed today's scans of older Zoho-PO lines
 * into long-past weeks, so the current-week History view rendered its empty
 * state while the rail was full of the very same activity.
 *
 * The 'unboxed' axis (History's Sort → Unboxed) bands + orders by `unboxed_at`,
 * and 'received' by `received_done_at` (the terminal DONE transition) — each
 * falling back to scan/created so a row not yet at that stage still lands in a
 * real day band rather than collapsing to "Unknown". History is client-sorted
 * (serverSorted=false), so switching this axis is what actually reorders the
 * feed — the server just returns the matching 500-row window.
 */
type ReceivingActivityAxis = 'scanned' | 'unboxed' | 'received';

function receivingRowActivityTs(
  row: {
    last_activity_at?: string | null;
    created_at?: string | null;
    unboxed_at?: string | null;
    received_done_at?: string | null;
  },
  axis: ReceivingActivityAxis = 'scanned',
): string | null {
  if (axis === 'unboxed') {
    return row.unboxed_at ?? row.last_activity_at ?? row.created_at ?? null;
  }
  if (axis === 'received') {
    return row.received_done_at ?? row.unboxed_at ?? row.last_activity_at ?? row.created_at ?? null;
  }
  return row.last_activity_at ?? row.created_at ?? null;
}

function receivingRowActivityMs(
  row: {
    last_activity_at?: string | null;
    created_at?: string | null;
    unboxed_at?: string | null;
    received_done_at?: string | null;
  },
  axis: ReceivingActivityAxis = 'scanned',
): number {
  const raw = receivingRowActivityTs(row, axis);
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * A purchase-order group: every receiving line that shares a PO, collapsed into
 * a single expandable row. `anchorTs` is the timestamp the group is placed by in
 * the day-banded feed — the PO's most-recent activity (or its Zoho PO date for
 * Incoming) — so a PO whose lines were scanned across several days lands in the
 * band of its latest scan instead of fragmenting. Singleton groups (a one-line
 * PO, or an unmatched carton with no PO) render as a plain row.
 */
interface ReceivingPoGroup {
  key: string;
  rows: ReceivingLineRow[];
  anchorTs: string | null;
}

function poGroupAnchorMs(group: ReceivingPoGroup): number {
  const t = group.anchorTs ? new Date(group.anchorTs).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/** Short absolute "M/D h:mm" for the history scanned/unboxed timeline. */
function fmtShortTs(ts?: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Row-anchored "Add tracking" — only rendered on Incoming AWAITING_TRACKING rows
 * (PO exists, no shipment registered yet). Opens the attach popover pre-targeted
 * to this PO, so the operator attaches tracking without re-searching for the PO
 * they're already looking at. stopPropagation keeps the click off the row's
 * select / group-toggle handlers.
 */
function IncomingAttachTrackingButton({
  poId,
  poNumber,
}: {
  poId: string;
  poNumber: string | null;
}) {
  return (
    <IncomingAttachTrackingPopover
      presetPo={{ poId, poNumber }}
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          title="Attach a tracking number to this PO before the box arrives"
          // Sits in the empty tracking chip slot — the shared AddValueChipFace
          // (dashed underline = "nothing here yet, click to add"). Same face the
          // dashboard paste-tracking button uses, so the two can't drift.
          className="inline-flex shrink-0 items-center transition-colors"
        >
          <AddValueChipFace label="Add TRK#" icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} />
        </button>
      }
    />
  );
}

export function ReceivingLineOrderRow({
  row,
  isSelected,
  onSelect,
  index,
  isMobile,
  isIncoming = false,
  isHistory = false,
  selectMode = false,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
  isMobile: boolean;
  /** Incoming view: serials aren't assigned until unboxing and the carrier /
   *  "EXPECTED" status are redundant, so we drop those chips/labels. */
  isIncoming?: boolean;
  /** History view: everything shown has already been received (an unfound box
   *  is received too — it just can't be marked received in Zoho because the PO
   *  isn't found there). So the workflow status icon (EXPECTED clock / RECEIVED
   *  check) and the testing verdict (FAILED box) are noise — we drop the icon
   *  and read the dot as a uniform "received" green. */
  isHistory?: boolean;
  /** Multi-select mode: render a checkbox and treat `isSelected` as "checked".
   *  Click toggles membership instead of opening the workspace. */
  selectMode?: boolean;
}) {
  // Unfound cartons (no Zoho PO) arrive labelled "Unfound PO" from the server
  // (buildUnmatchedEmptyReceivingLine / UNMATCHED_EMPTY_LINE_LABEL).
  const productTitle =
    row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  // The workflow status renders as a compact icon (not text) — RECEIVED and
  // EXPECTED are the dominant states; everything else falls back to a generic
  // package glyph. The label rides along as the `title` for hover/a11y.
  const { Icon: WorkflowIcon, tone: workflowIconTone } = getWorkflowIconMeta(workflowLabel);
  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const conditionColor =
    condGrade === 'BRAND_NEW'
      ? 'text-yellow-600'
      : condGrade === 'PARTS'
        ? 'text-amber-800'
        : condGrade.startsWith('USED')
          ? 'text-gray-500'
          : 'text-gray-500';
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  // Derived faceted state (view=incoming) now renders as a compact icon with a
  // hover label via <DeliveryStateIcon>, instead of a long text suffix.
  // Join all serials so SerialChip's CSV-aware helper picks the most recent and
  // shows its last 6 chars. Clipboard carries the full list for traceability.
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-line-row-id={row.id}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role={selectMode ? 'checkbox' : 'button'}
      tabIndex={0}
      aria-checked={selectMode ? isSelected : undefined}
      aria-pressed={selectMode ? undefined : isSelected}
      aria-label={`Select receiving line ${row.id}`}
      className={`${dashboardOrderRowShellClass(isMobile)} border-b border-gray-100 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
      }`}
    >
      <div className="flex min-w-0 flex-col">
        <RowTitle
          leading={
            selectMode ? (
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
            ) : undefined
          }
          // History reads as received across the board (unfound boxes included),
          // so the dot is a uniform "received" green there rather than the
          // workflow-derived color that paints unfound rows amber/"pending".
          dot={isHistory ? 'bg-emerald-500' : getStatusDotBg(row.workflow_status, row.quantity_received, row.quantity_expected)}
          dotTitle={isHistory ? 'Received' : workflowLabel}
          dotTrack={META_COL.dotTrackWide}
          title={productTitle}
        />
        <RowMetaColumns
          // In select mode the title row gains a leading checkbox (w-4 + mr-2 =
          // 1.5rem), shifting the title text right. Add that same offset to the
          // meta indent so the qty · condition · rest subrow stays aligned under
          // the title instead of stranding at the original (un-shifted) x.
          indent={selectMode ? `calc(${META_COL.indentWide} + 1.5rem)` : META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={
            <span className={qtyExpected > 1 ? 'text-yellow-600' : row.quantity_expected && row.quantity_received >= row.quantity_expected ? 'text-emerald-600' : 'text-gray-500'}>
              {quantityText}
            </span>
          }
          condition={<span className={condGrade === 'BRAND_NEW' ? 'text-yellow-600' : condGrade === 'PARTS' ? 'text-amber-800' : 'text-gray-400'}>{conditionLabel}</span>}
          rest={
            <div className="flex items-center gap-2">
              {/* History timeline: door-scan ("scanned at") and unbox times +
                  who. Gated on data so incoming/expected rows stay clean.
                  Desktop-only — the mobile table isn't the history surface. */}
              {!isIncoming && (row.scanned_at || row.received_at || row.unboxed_at) ? (
                <span
                  className="hidden items-center gap-1.5 text-eyebrow font-semibold text-gray-400 sm:inline-flex"
                  title={[
                    fmtShortTs(row.scanned_at ?? row.received_at)
                      ? `Scanned ${fmtShortTs(row.scanned_at ?? row.received_at)}${row.scanned_by_name ? ` by ${row.scanned_by_name}` : ''}`
                      : '',
                    fmtShortTs(row.unboxed_at)
                      ? `Unboxed ${fmtShortTs(row.unboxed_at)}${row.unboxed_by_name ? ` by ${row.unboxed_by_name}` : ''}`
                      : '',
                  ].filter(Boolean).join(' · ')}
                >
                  {fmtShortTs(row.scanned_at ?? row.received_at) ? (
                    <span>↓ {fmtShortTs(row.scanned_at ?? row.received_at)}{row.scanned_by_name ? ` · ${row.scanned_by_name}` : ''}</span>
                  ) : null}
                  {fmtShortTs(row.unboxed_at) ? (
                    <span>📦 {fmtShortTs(row.unboxed_at)}{row.unboxed_by_name ? ` · ${row.unboxed_by_name}` : ''}</span>
                  ) : null}
                </span>
              ) : null}
              {/* Workflow status icon: shown in the active receive workspace,
                  hidden in History (received is implied; EXPECTED doesn't apply
                  since unfound is still received) and in Incoming. This also
                  drops the testing verdict (FAILED box) from the unbox history. */}
              {shouldShowWorkflowStatusIcon({ isHistory, isIncoming }) ? (
                <IconWithTooltip
                  Icon={WorkflowIcon}
                  label={workflowLabel}
                  iconClassName={workflowIconTone}
                />
              ) : null}
              <DeliveryStateIcon state={row.delivery_state} />
            </div>
          }
        />
      </div>

      <ReceivingIdentityChips
        po={poValue}
        sku={skuValue}
        tracking={trackingValue}
        serialsCsv={serialsCsv}
        includeSerial={!isIncoming}
        asColumns={!isMobile}
        className={dashboardOrderRowChipsClass(isMobile)}
        // Incoming AWAITING_TRACKING: the empty tracking chip becomes the
        // "Add tracking" trigger, pre-targeted to this PO.
        trackingAction={
          isIncoming && row.delivery_state === 'AWAITING_TRACKING' && (row.zoho_purchaseorder_id || '').trim()
            ? (
              <IncomingAttachTrackingButton
                poId={(row.zoho_purchaseorder_id || '').trim()}
                poNumber={row.zoho_purchaseorder_number}
              />
            )
            : undefined
        }
      />
    </div>
  );
}

/**
 * Collapsed-PO summary — the header content for a {@link CollapsibleGroupRow}
 * wrapping several receiving lines that share a purchase order. Built from the
 * SAME RowTitle / RowMetaColumns / ChipColumns primitives a single line row uses
 * so it lines up pixel-for-pixel with its children.
 *
 * The title is the shared identity — {platform · PO} — rather than one product
 * name, since the lines are different products. On the chip side, PO and (when
 * uniform) tracking sit in their real columns; the SKU and serial columns DIFFER
 * per line, so each shows its own icon with a yellow "×N" count ({@link SkuCountChip}
 * / {@link SerialCountChip}) — a "these vary, expand to see them" cue that still
 * keeps every column aligned with the rows beneath it.
 */
function ReceivingPoSummary({
  rows,
  isMobile,
  isIncoming,
  isHistory = false,
}: {
  rows: ReceivingLineRow[];
  isMobile: boolean;
  isIncoming: boolean;
  isHistory?: boolean;
}) {
  const first = rows[0];

  const received = rows.reduce((sum, r) => sum + (r.quantity_received || 0), 0);
  const expected = rows.reduce((sum, r) => sum + (r.quantity_expected ?? 0), 0);
  const quantityText = `${received}/${expected || '?'}`;
  const complete = expected > 0 && received >= expected;

  const grades = new Set(
    rows.map((r) => (r.condition_grade || '').toUpperCase()).filter(Boolean),
  );
  const conditionLabel =
    grades.size === 1 ? conditionGradeTableLabel([...grades][0]) : 'MIXED';

  const poValue = (
    first?.zoho_purchaseorder_number ||
    first?.zoho_purchaseorder_id ||
    ''
  ).trim();

  // Title = the group's shared identity: platform + PO. Falls back gracefully
  // when either is missing (e.g. an un-platformed Zoho carton → just "PO 3715").
  const platformRaw = (first?.source_platform || '').trim().toLowerCase();
  const platformLabel = platformRaw
    ? (SOURCE_PLATFORM_LABELS[platformRaw] ?? (platformRaw === 'zoho' ? 'Zoho' : platformRaw))
    : '';
  const title =
    [platformLabel, poValue ? `PO ${poValue}` : '']
      .filter(Boolean)
      .join(' · ') || (first?.item_name ?? 'Grouped lines');

  // Only surface tracking when every line shares one carton; otherwise leave the
  // column empty so the summary never implies a single tracking# for a split PO.
  const trackings = new Set(
    rows.map((r) => (r.tracking_number || '').trim()).filter(Boolean),
  );
  const trackingValue = trackings.size === 1 ? [...trackings][0] : '';

  // The differing columns carry a yellow "×N" count instead of a value. SKU is
  // one-per-line, so its count is the line count.
  const skuCount = rows.length;
  // Serials collapse with the standard 0 / 1 / N rule: none → empty column, a
  // single serial across the whole group → show that real SerialChip, several →
  // the "×N" count. (Same rule the FBA summary will apply to FNSKUs.)
  const allSerials = rows.flatMap((r) =>
    (r.serials ?? []).map((s) => (s.serial_number || '').trim()).filter(Boolean),
  );
  const serialNode =
    allSerials.length === 1 ? (
      <SerialChip value={allSerials[0]} width="w-fit max-w-full" />
    ) : allSerials.length > 1 ? (
      <SerialCountChip count={allSerials.length} />
    ) : null;

  // Status dot + status icons mirror the per-line row, so the collapsed summary
  // carries the same signal its children do instead of a bare gray dot. The
  // workflow status / delivery state are folded up only when uniform across the
  // group; mixed groups fall back to no icon (expand to see the per-line state).
  const workflowStatuses = new Set(
    rows.map((r) => (r.workflow_status || 'EXPECTED').toUpperCase()),
  );
  const uniformWorkflowStatus =
    workflowStatuses.size === 1 ? [...workflowStatuses][0] : null;
  const workflowLabel = workflowStatusTableLabel(uniformWorkflowStatus || 'EXPECTED');
  const { Icon: WorkflowIcon, tone: workflowIconTone } = getWorkflowIconMeta(workflowLabel);

  const deliveryStates = new Set(
    rows.map((r) => r.delivery_state).filter(Boolean) as string[],
  );
  const uniformDeliveryState =
    deliveryStates.size === 1 ? [...deliveryStates][0] : null;

  // Mirror the per-line ChipColumns grid exactly, column-for-column.
  const columns: ChipColumn[] = [
    { key: 'po', width: CHIP_COL.id, node: <OrderIdChip value={poValue} display={getLast4(poValue)} /> },
    { key: 'sku', width: CHIP_COL.id, node: <SkuCountChip count={skuCount} /> },
    {
      key: 'tracking',
      width: CHIP_COL.tracking,
      // Incoming AWAITING_TRACKING with no carton-wide tracking → the empty
      // tracking slot hosts the "Add tracking" trigger, pre-targeted to this PO.
      node: trackingValue
        ? <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        : isIncoming && uniformDeliveryState === 'AWAITING_TRACKING' && (first?.zoho_purchaseorder_id || '').trim()
          ? (
            <IncomingAttachTrackingButton
              poId={(first!.zoho_purchaseorder_id || '').trim()}
              poNumber={first?.zoho_purchaseorder_number ?? null}
            />
          )
          : null,
    },
  ];
  if (!isIncoming) {
    columns.push({ key: 'serial', width: CHIP_COL.serial, node: serialNode });
  }

  return (
    <div className={dashboardOrderRowShellClass(isMobile)}>
      <div className="flex min-w-0 flex-col">
        <RowTitle
          // History reads uniformly "received"; otherwise derive the dot from
          // the (uniform) workflow status + qty so it matches the child rows
          // instead of always rendering gray.
          dot={isHistory ? 'bg-emerald-500' : getStatusDotBg(uniformWorkflowStatus, received, expected)}
          dotTitle={isHistory ? 'Received' : `${rows.length} lines`}
          dotTrack={META_COL.dotTrackWide}
          title={title}
        />
        <RowMetaColumns
          indent={META_COL.indentWide}
          qtyCol={META_COL.qtyColWide}
          qty={
            <span className={complete ? 'text-emerald-600' : 'text-yellow-600'}>
              {quantityText}
            </span>
          }
          condition={<span className="text-gray-400">{conditionLabel}</span>}
          rest={
            <div className="flex items-center gap-2">
              {shouldShowWorkflowStatusIcon({ isHistory, isIncoming }) ? (
                <IconWithTooltip
                  Icon={WorkflowIcon}
                  label={workflowLabel}
                  iconClassName={workflowIconTone}
                />
              ) : null}
              <DeliveryStateIcon state={uniformDeliveryState} />
            </div>
          }
        />
      </div>
      {isMobile ? (
        <div className={dashboardOrderRowChipsClass(true)}>
          <OrderIdChip value={poValue} display={getLast4(poValue)} dense />
          <SkuCountChip count={skuCount} dense />
          {trackingValue ? <TrackingChip value={trackingValue} display={getLast4(trackingValue)} dense /> : null}
          {allSerials.length === 1 ? (
            <SerialChip value={allSerials[0]} width="w-fit max-w-full" dense />
          ) : allSerials.length > 1 ? (
            <SerialCountChip count={allSerials.length} dense />
          ) : null}
        </div>
      ) : (
        <ChipColumns columns={columns} />
      )}
    </div>
  );
}

/**
 * Shipment-anchored "delivered, no dock scan yet" box (incoming-only). The
 * endpoint resolves each box's Zoho PO from its tracking#, so PO#, vendor,
 * dates and the product/item name ride along — these render with the same
 * fidelity as any other incoming PO row.
 */
interface DeliveredUnscanned {
  shipment_id: number;
  carrier: string;
  tracking_number_raw: string;
  tracking_number_normalized: string;
  delivered_at: string | null;
  source_system: string | null;
  zoho_purchaseorder_id: string | null;
  po_number: string | null;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  po_date: string | null;
  first_item_name: string | null;
  first_sku: string | null;
  item_count: number | null;
}

interface DeliveredUnscannedResponse {
  success: boolean;
  count: number;
  window_days: number;
  items: DeliveredUnscanned[];
}

/**
 * Synthetic-row id base for shipment-anchored "delivered · not scanned" boxes.
 * They have no receiving_line, so we mint a negative, collision-free id from the
 * shipment id: `id = BASE - shipment_id`. Keep the encode ({@link deliveredUnscannedToRow})
 * and decode ({@link shipmentIdFromDeliveredUnscannedRow}) in lockstep so the
 * incoming details panel can recover the real shipment id for its delete path.
 */
export const DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE = -2_000_000;

/**
 * Recover the `shipping_tracking_numbers.id` from a synthetic delivered-unscanned
 * row, or null if `row` isn't one. A delivered-unscanned row is the only producer
 * of `tracking_source === 'shipment'` with a negative id (see {@link deliveredUnscannedToRow}).
 */
export function shipmentIdFromDeliveredUnscannedRow(row: ReceivingLineRow): number | null {
  if (row.tracking_source !== 'shipment' || row.id >= 0) return null;
  const shipmentId = DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE - row.id; // inverse of id = BASE - shipment_id
  return Number.isFinite(shipmentId) && shipmentId > 0 ? shipmentId : null;
}

/**
 * Remap a shipment-anchored "delivered but not dock-scanned" box onto the
 * standard {@link ReceivingLineRow} shape so the "Delivered · not scanned"
 * facet renders through the very same date-grouping + {@link ReceivingLineOrderRow}
 * pipeline as every other history/incoming row — no bespoke pane. Mirrors the
 * server's `buildUnmatchedEmptyReceivingLine` placeholder: there's no PO line
 * yet, so quantities are zero and the carton reads as an unmatched delivery.
 */
function deliveredUnscannedToRow(item: DeliveredUnscanned): ReceivingLineRow {
  // Product title: the PO's first line item, with a "+N more" hint when the PO
  // spans several lines. Falls back to the PO# (or a generic label) when the
  // line names aren't synced yet.
  const itemCount = item.item_count ?? 0;
  const productTitle = item.first_item_name
    ? itemCount > 1
      ? `${item.first_item_name} +${itemCount - 1} more`
      : item.first_item_name
    : item.po_number
      ? `PO ${item.po_number}`
      : 'Delivered · needs receiving';

  return {
    id: DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE - item.shipment_id,
    receiving_id: null,
    tracking_number: item.tracking_number_raw,
    tracking_source: 'shipment',
    carrier: item.carrier,
    shipment_status: 'DELIVERED',
    is_delivered: true,
    delivered_at: item.delivered_at,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: item.zoho_purchaseorder_id,
    zoho_purchaseorder_number: item.po_number,
    item_name: productTitle,
    sku: item.first_sku,
    quantity_received: 0,
    quantity_expected: itemCount > 0 ? itemCount : null,
    qa_status: 'PENDING',
    workflow_status: 'EXPECTED',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    disposition_audit: [],
    needs_test: false,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    delivery_state: 'DELIVERED_UNOPENED',
    po_date: item.po_date,
    expected_delivery_date: item.expected_delivery_date,
    vendor_name: item.vendor_name,
    created_at: item.delivered_at,
    last_activity_at: item.delivered_at,
    image_url: null,
    source_platform: null,
    is_priority: false,
    priority_tier: null,
    receiving_source: 'unmatched',
    serials: [],
    photo_count: 0,
    zendesk_ticket: null,
  };
}

export default function ReceivingLinesTable({ selectMode = false }: { selectMode?: boolean } = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMobile } = useUIModeOptional();
  const pageMode = searchParams.get('mode') ?? 'receive';
  // The active mode descriptor owns every data-layer decision (which API view
  // to request, how to page/key/group/sort, the empty copy). Adding a mode =
  // adding a registry entry; the component just delegates. isIncomingMode
  // remains only for the presentational fork (Incoming's purpose-built header +
  // row chips) and the incoming-only effects below.
  const mode = getReceivingModeDescriptor(pageMode);
  const isIncomingMode = mode.id === 'incoming';
  const isHistoryMode = mode.id === 'history';

  const historySearch = searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '';
  const historySearchField = normalizeReceivingHistorySearchField(
    searchParams.get(RECEIVING_HISTORY_URL_PARAMS.field),
  );
  const historySearchScope = normalizeReceivingHistorySearchScope(
    searchParams.get(RECEIVING_HISTORY_URL_PARAMS.scope),
  );

  // Incoming-only URL params: shares `?q=` with history's search box (free
  // text), adds `?state=` for the delivery_state facet. Keeping `q` on the
  // same key means the search bar value survives a mode flip from Incoming
  // → History without surprising the operator.
  const incomingSearch = isIncomingMode
    ? (searchParams.get(RECEIVING_HISTORY_URL_PARAMS.q)?.trim() ?? '')
    : '';
  const incomingStateRaw = (searchParams.get('state') || '').trim().toUpperCase();
  const incomingState: IncomingDeliveryState | null =
    incomingStateRaw === 'DELIVERED_UNOPENED'
      || incomingStateRaw === 'ARRIVING_TODAY'
      || incomingStateRaw === 'STALLED'
      || incomingStateRaw === 'IN_TRANSIT'
      || incomingStateRaw === 'TRACKING_UNAVAILABLE'
      || incomingStateRaw === 'PENDING_CARRIER'
      || incomingStateRaw === 'CARRIER_MISMATCH'
      || incomingStateRaw === 'AWAITING_TRACKING'
      ? (incomingStateRaw as IncomingDeliveryState)
      : null;
  // Sort axis + PO date range — driven by IncomingPaneHeader (sort) and
  // IncomingSidebarPanel (date range). All three values flow straight into
  // the API query string below; no client-side filtering of date range
  // because the server already narrows results.
  const incomingSort = isIncomingMode ? (searchParams.get('sort') || '').trim() : '';
  // History reuses the shared `?sort=` param (modes are exclusive). The axis it
  // resolves to drives both the server window and the client day-banding below.
  const historySort = isHistoryMode ? (searchParams.get('sort') || '').trim() : '';
  const historyAxis = isHistoryMode ? historySortGroupAxis(historySort) : 'scanned';
  const incomingPoFrom = isIncomingMode ? (searchParams.get('po_from') || '').trim() : '';
  const incomingPoTo = isIncomingMode ? (searchParams.get('po_to') || '').trim() : '';
  // Pagination — server-side LIMIT 50 + page offset. Page numbers are
  // 1-based in the URL ("?page=2" = second page). Anything malformed or
  // missing falls back to 1.
  const incomingPageRaw = isIncomingMode ? Number(searchParams.get('page') || '1') : 1;
  const incomingPage =
    Number.isFinite(incomingPageRaw) && incomingPageRaw >= 1 ? Math.floor(incomingPageRaw) : 1;

  // "Delivered · not scanned" is an Incoming sub-facet fed by a separate
  // shipment-level query; it owns its own empty copy, so the descriptor needs
  // to know about it. Derived early (only depends on incomingState) so it can
  // flow into the mode context below.
  const isDeliveredUnscannedFacet =
    isIncomingMode && incomingState === 'DELIVERED_UNOPENED';

  // Single bag of parsed URL state handed to the active descriptor for every
  // data-layer decision. Memoized so the query key / params stay referentially
  // stable across unrelated re-renders.
  const modeContext = useMemo<ReceivingModeContext>(
    () => ({
      historySearch,
      historySearchField,
      historySearchScope,
      historySort,
      incomingSearch,
      incomingState,
      incomingSort,
      incomingPoFrom,
      incomingPoTo,
      incomingPage,
      isDeliveredUnscannedFacet,
    }),
    [
      historySearch,
      historySearchField,
      historySearchScope,
      historySort,
      incomingSearch,
      incomingState,
      incomingSort,
      incomingPoFrom,
      incomingPoTo,
      incomingPage,
      isDeliveredUnscannedFacet,
    ],
  );

  const skipWeekFilter = mode.skipWeekFilter(modeContext);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Multi-select (bulk) state — only active when `selectMode` is on. Kept as a
  // Set of row ids; the resolved rows are broadcast on RECEIVING_SELECTION_SCOPE
  // for the SelectionActionBar.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekRange = computeWeekRange(weekOffset);

  // Query key + params both come from the active descriptor — see
  // src/lib/receiving/receiving-modes.ts. The key varies with every
  // server-affecting input so react-query refetches correctly on a facet flip.
  const queryKey = mode.queryKey(modeContext);
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-lines?${mode.buildParams(modeContext).toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  // "Delivered · not scanned" facet: these boxes are shipment-anchored with no
  // PO line, so the incoming list query above returns nothing for them. Pull
  // the shipment-level feed and remap each onto a ReceivingLineRow so they flow
  // through the same grouping + ReceivingLineOrderRow render path as the rest of
  // the table (reusing the history components instead of a bespoke pane). Shares
  // the `incoming-delivered-unscanned` key so the sidebar's Refresh-tracking
  // button still re-fetches it. (isDeliveredUnscannedFacet is derived up top so
  // it can feed the mode context.)
  const { data: deliveredData } = useQuery<DeliveredUnscannedResponse>({
    queryKey: ['incoming-delivered-unscanned'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/delivered-unscanned', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('delivered-unscanned fetch failed');
      return res.json();
    },
    enabled: isDeliveredUnscannedFacet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const deliveredRows = useMemo<ReceivingLineRow[]>(
    () =>
      isDeliveredUnscannedFacet
        ? (deliveredData?.items ?? []).map(deliveredUnscannedToRow)
        : [],
    [isDeliveredUnscannedFacet, deliveredData],
  );

  // IncomingSidebarPanel owns the search + facet controls; the table just
  // reads the URL params it writes. Summary polling lives in the sidebar so
  // the count rendering doesn't unmount on a right-pane row click.

  useEffect(() => {
    if (isDeliveredUnscannedFacet) {
      setLocalRows(deliveredRows);
      return;
    }
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data, isDeliveredUnscannedFacet, deliveredRows]);

  // Incoming: if `?page` is past the end of the filtered result set (e.g.
  // operator was on page 7 with 175+ rows, then filtered to 18 → page 7
  // requests offset 150 → server returns 0 rows), drop the bad page param
  // so the table re-fetches page 1 instead of stranding on an empty pane.
  useEffect(() => {
    if (!isIncomingMode) return;
    const total = Number(data?.total ?? 0);
    if (total === 0) return;
    const maxPage = Math.max(1, Math.ceil(total / INCOMING_PAGE_SIZE));
    if (incomingPage > maxPage) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('page');
      router.replace(`/receiving?${params.toString()}`);
    }
  }, [isIncomingMode, data?.total, incomingPage, router, searchParams]);

  // The selected row left the table's dataset — deleted, filtered out, or (an
  // unfound placeholder's case) REPLACED by its real line after the carton
  // graduated to a PO match. Clear only the table's own highlight. This used
  // to also broadcast dispatchSelectLine(null), which tore down the right-pane
  // workspace mid-flow: the table is mounted (hidden) in Unbox/Triage and
  // refetches on usav-refresh-data, so a serial-match import that graduated
  // the open unfound carton made its placeholder row vanish here → global
  // deselect → workspace closed → the dashboard's never-blank effect opened an
  // unrelated "most recent" line. True deletions broadcast
  // receiving-line-deleted / receiving-entry-deleted, which the sidebar and
  // dashboard already handle.
  useEffect(() => {
    if (!selectedId) return;
    if (!localRows.some((row) => row.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, localRows]);

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  useEffect(() => {
    const handler = (event: Event) => {
      const updated = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      // Merge — some dispatchers (e.g. mark-received) return the raw DB
      // row without the joined fields the list endpoint computes
      // (tracking_number, carrier, zoho_purchaseorder_number, etc). A
      // wholesale replace would blank those. Shallow-merge keeps the
      // existing joined data while applying whatever fresh columns came
      // through (quantity_received, qa_status, workflow_status, …).
      setLocalRows((rows) =>
        rows.map((row) => (row.id === updated.id ? { ...row, ...updated } as ReceivingLineRow : row)),
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
  }, []);

  // Tracking scan/search match → prepend matched lines at the top (dedupe by id).
  // Receive flow and other tools dispatch this; History mode primarily uses URL-driven API fetch.
  useEffect(() => {
    const handler = (event: Event) => {
      const raw = (event as CustomEvent<unknown>).detail;
      let incoming: ReceivingLineRow[] = [];
      if (Array.isArray(raw)) {
        incoming = raw as ReceivingLineRow[];
      } else if (raw && typeof raw === 'object' && Array.isArray((raw as { rows?: unknown }).rows)) {
        incoming = (raw as { rows: ReceivingLineRow[] }).rows;
      }
      if (incoming.length === 0) return;
      const incomingIds = new Set(incoming.map((r) => r.id));
      setLocalRows((rows) => {
        const kept = rows.filter((r) => !incomingIds.has(r.id));
        return [...incoming, ...kept];
      });
      setWeekOffset(0);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    };
    window.addEventListener('receiving-lines-prepended', handler);
    return () => window.removeEventListener('receiving-lines-prepended', handler);
  }, []);

  // External highlight — the sidebar's up/down arrows fire this event to
  // move the selected-row indicator in the table without the full
  // row-click semantics (which would wipe sidebar state). detail is the
  // receiving_line id or null to clear.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<number | null>).detail;
      setSelectedId(typeof detail === 'number' ? detail : null);
    };
    window.addEventListener('receiving-highlight-line', handler);
    return () => window.removeEventListener('receiving-highlight-line', handler);
  }, []);

  // Track whichever row is currently mounted in the workspace overlay, so
  // the receiving-navigate-table prev/next handler below has a reference
  // point. Without this, opening the workspace via dispatchReceivingWorkspaceOpen
  // (Edit PO, etc.) leaves selectedIdRef null and prev/next no-ops.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ row?: { id?: number } } | null>).detail;
      const id = Number(detail?.row?.id);
      if (Number.isFinite(id) && id > 0) {
        setSelectedId(id);
      }
    };
    window.addEventListener('receiving-workspace-open', handler);
    return () => window.removeEventListener('receiving-workspace-open', handler);
  }, []);

  // Track selectedId in a ref so the click handler can read the current value
  // without a stale closure — the dispatch must happen OUTSIDE the setState
  // updater (updaters must be pure; dispatching a custom event synchronously
  // triggers the sidebar's setState and React flags it as "setState during
  // render of a different component").
  const selectedIdRef = useRef<number | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Last-applied `recvId:lineId` — keyed (not boolean) so the SAME deep link
  // doesn't re-fire on every row refresh, while a NEW one applied mid-session
  // (e.g. triage's "Open in unbox" pushing a different recvId) still lands.
  const deepLinkAppliedRef = useRef<string | null>(null);
  const initialAutoSelectRef = useRef(false);

  // Deep link from shared URL: /receiving?recvId=…&lineId=… (lineId optional).
  useEffect(() => {
    const recvIdParam = searchParams.get('recvId');
    if (!recvIdParam || !/^\d+$/.test(recvIdParam)) return;
    if (isLoading || localRows.length === 0) return;
    const lineIdParam = searchParams.get('lineId');
    const deepLinkKey = `${recvIdParam}:${lineIdParam ?? ''}`;
    if (deepLinkAppliedRef.current === deepLinkKey) return;

    const recvId = Number(recvIdParam);
    const lineId =
      lineIdParam && /^\d+$/.test(lineIdParam) ? Number(lineIdParam) : null;

    let target =
      lineId != null
        ? localRows.find((r) => r.id === lineId && r.receiving_id === recvId) ??
          localRows.find((r) => r.id === lineId)
        : undefined;
    if (!target) {
      target = localRows.find((r) => r.receiving_id === recvId);
    }
    if (!target) return;

    deepLinkAppliedRef.current = deepLinkKey;
    initialAutoSelectRef.current = true;
    setSelectedId(target.id);
    dispatchSelectLine(target);
    window.dispatchEvent(new CustomEvent('receiving-highlight-line', { detail: target.id }));
  }, [isLoading, localRows, searchParams]);

  // On first visit to Receiving (no row selected yet), auto-select the latest
  // line from the API list (ORDER BY last scan / received_at / created_at DESC).
  // Auto-select-on-first-visit was disabled: the new UX model is that the
  // Receiving tab shows a "scan to start" empty state when nothing's active,
  // and the History tab is a deliberate read-only browse — both rule out
  // silently jumping into the latest row. Deep links via `?recvId=` still
  // work because that runs in a separate effect above.
  useEffect(() => {
    if (initialAutoSelectRef.current) return;
    initialAutoSelectRef.current = true;
  }, []);

  // Read selectMode without re-creating handlers / re-subscribing listeners.
  const selectModeRef = useRef(selectMode);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

  const handleSelectRow = useCallback((row: ReceivingLineRow) => {
    if (selectModeRef.current) {
      // Bulk mode: toggle membership; never open the workspace.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      return;
    }
    const next = selectedIdRef.current === row.id ? null : row.id;
    setSelectedId(next);
    dispatchSelectLine(next ? row : null);
  }, []);

  // ── Day grouping (PST) ────────────────────────────────────────────────────
  // Incoming groups by the Zoho PO date (`po_date` from zoho_po_mirror) so
  // the day band reflects when the buyer authored the PO upstream — not when
  // we synced it locally. Other modes keep the legacy created_at grouping.
  // Collapse duplicate "Unfound receiving" cartons. An unmatched package that
  // never resolves to a PO has no line, so each scan of it surfaces as its own
  // synthetic placeholder row (id < 0). Scanning the same un-found box several
  // times therefore stacks identical tracking-number rows in History. We keep
  // only the most-recent scan per tracking number. ONLY placeholders are
  // touched — a real PO carton legitimately has many lines sharing a tracking #,
  // so those are never merged.
  const dedupedRows = useMemo(() => {
    const seenByTracking = new Map<string, number>(); // tracking → index in out
    const out: ReceivingLineRow[] = [];
    for (const row of localRows) {
      const isUnfoundPlaceholder = row.id < 0;
      const trackingKey = (row.tracking_number || '').trim().toLowerCase();
      if (!isUnfoundPlaceholder || !trackingKey) {
        out.push(row);
        continue;
      }
      const existingIdx = seenByTracking.get(trackingKey);
      if (existingIdx == null) {
        seenByTracking.set(trackingKey, out.length);
        out.push(row);
      } else if (
        receivingRowActivityMs(row) > receivingRowActivityMs(out[existingIdx])
      ) {
        out[existingIdx] = row;
      }
    }
    return out;
  }, [localRows]);

  // Collapse the flat lines into one row per purchase order, GLOBALLY — a PO's
  // lines merge into a single group even when they were scanned across several
  // days (the day band the group lands in is decided by `anchorTs`, its latest
  // activity). Lines with no PO (unmatched cartons, placeholders) get a unique
  // key so they stay singletons and render as plain rows.
  const poGroups = useMemo<ReceivingPoGroup[]>(() => {
    const grouped = groupRowsBy(dedupedRows, (row) => {
      const po = (
        row.zoho_purchaseorder_number ||
        row.zoho_purchaseorder_id ||
        ''
      ).trim();
      return po ? `po:${po}` : `line:${row.id}`;
    });
    return grouped.map(({ key, rows }) => {
      let anchorTs: string | null = null;
      if (mode.groupAxis === 'po_date') {
        anchorTs = rows.find((r) => r.po_date)?.po_date ?? rows[0]?.created_at ?? null;
      } else {
        // History's Sort axis (scanned vs unboxed) decides which timestamp the
        // group is banded + ordered by; Receive always uses scan activity.
        let bestMs = -1;
        for (const r of rows) {
          const ms = receivingRowActivityMs(r, historyAxis);
          if (ms > bestMs) {
            bestMs = ms;
            anchorTs = receivingRowActivityTs(r, historyAxis);
          }
        }
      }
      return { key, rows, anchorTs };
    });
  }, [dedupedRows, mode.groupAxis, historyAxis]);

  const groupedRecords = useMemo(() => {
    const groups: Record<string, ReceivingPoGroup[]> = {};
    for (const group of poGroups) {
      let date = 'Unknown';
      try {
        date = toPSTDateKey(group.anchorTs) || 'Unknown';
      } catch {
        date = 'Unknown';
      }
      if (!groups[date]) groups[date] = [];
      groups[date].push(group);
    }
    return groups;
  }, [poGroups]);

  const filteredGroupedRecords = useMemo(() => {
    if (skipWeekFilter) return groupedRecords;
    return Object.fromEntries(
      Object.entries(groupedRecords).filter(
        ([date]) => date >= weekRange.startStr && date <= weekRange.endStr,
      ),
    );
  }, [groupedRecords, weekRange.startStr, weekRange.endStr, skipWeekFilter]);

  /** Flat list of LINES in render order — newest day → newest group → its lines.
   *  Drives selection broadcast, arrow-nav and scroll-into-view (those operate on
   *  individual lines, not PO groups). Incoming defers to the API's server-side
   *  ORDER BY; other modes re-sort groups by latest activity within each day. */
  const orderedVisibleRows = useMemo(
    () =>
      Object.entries(filteredGroupedRecords)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .flatMap(([, dayGroups]) => {
          const sorted = mode.serverSorted
            ? dayGroups
            : [...dayGroups].sort(
                (a, b) => poGroupAnchorMs(b) - poGroupAnchorMs(a),
              );
          return sorted.flatMap((group) => group.rows);
        }),
    [filteredGroupedRecords, mode.serverSorted],
  );

  // History lands on the current PST week by default, but a fresh week (a
  // Sunday morning, or any day before that week's first scan) has zero activity
  // while last week is full — so the History tab rendered its empty state even
  // though the `activity` feed was returning plenty of rows (they just sat one
  // week back). When the current week is empty but earlier weeks have data, jump
  // the window back to the most recent week that actually has activity so
  // History always opens on rows. One-shot per mount, so manually paging forward
  // to an empty current week isn't bounced back.
  const autoWeekAppliedRef = useRef(false);
  useEffect(() => {
    if (!isHistoryMode || skipWeekFilter) return;
    if (autoWeekAppliedRef.current || weekOffset !== 0) return;
    // Current week already has rows → nothing to do; lock the one-shot.
    if (Object.keys(filteredGroupedRecords).length > 0) {
      autoWeekAppliedRef.current = true;
      return;
    }
    const latest = Object.keys(groupedRecords)
      .filter((d) => d !== 'Unknown')
      .sort((a, b) => b.localeCompare(a))[0];
    if (!latest) return; // still loading or genuinely empty — keep waiting.
    autoWeekAppliedRef.current = true;
    const curSunday = new Date(`${weekRange.startStr}T00:00:00`);
    const latestDate = new Date(`${latest}T00:00:00`);
    const diffDays = Math.round(
      (curSunday.getTime() - latestDate.getTime()) / 86_400_000,
    );
    if (diffDays > 0) setWeekOffset(Math.ceil(diffDays / 7));
  }, [
    isHistoryMode,
    skipWeekFilter,
    weekOffset,
    filteredGroupedRecords,
    groupedRecords,
    weekRange.startStr,
  ]);

  // ── Bulk selection wiring ───────────────────────────────────────────────────
  // Broadcast the resolved selected rows whenever the id set or the underlying
  // rows change, so the SelectionActionBar count + payload stay in sync.
  useEffect(() => {
    if (!selectMode) return;
    const byId = new Map(localRows.map((r) => [r.id, r]));
    const rows: ReceivingLineRow[] = [];
    for (const id of selectedIds) {
      const row = byId.get(id);
      if (row) rows.push(row);
    }
    emitSelection(RECEIVING_SELECTION_SCOPE, rows);
  }, [selectMode, selectedIds, localRows]);

  // Leaving select mode clears the selection (and notifies listeners).
  useEffect(() => {
    if (selectMode) return;
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
    emitSelection(RECEIVING_SELECTION_SCOPE, []);
  }, [selectMode]);

  // Header "Select all" / "Clear" → toggle every currently-visible row.
  useEffect(() => {
    return onToggleAll(RECEIVING_SELECTION_SCOPE, (mode) => {
      setSelectedIds(mode === 'all' ? new Set(orderedVisibleRows.map((r) => r.id)) : new Set());
    });
  }, [orderedVisibleRows]);

  // Publish the selectable total so the action bar's select-all ring can fill.
  // Zero outside select mode so a stale "all selected" never lingers.
  useEffect(() => {
    emitSelectionTotal(
      RECEIVING_SELECTION_SCOPE,
      selectMode ? orderedVisibleRows.length : 0,
    );
  }, [selectMode, orderedVisibleRows]);

  // Sidebar chevrons / arrow keys dispatch receiving-navigate-table.
  useEffect(() => {
    const handler = (event: Event) => {
      const direction = (event as CustomEvent<'prev' | 'next'>).detail;
      if (direction !== 'prev' && direction !== 'next') return;
      if (selectModeRef.current) return; // arrow-nav is for single-select only
      if (orderedVisibleRows.length === 0) return;

      const step = direction === 'prev' ? -1 : 1;
      const currentIndex = orderedVisibleRows.findIndex((row) => row.id === selectedIdRef.current);
      if (currentIndex < 0) return;

      const nextRow = orderedVisibleRows[currentIndex + step];
      if (!nextRow) return;
      handleSelectRow(nextRow);
    };
    window.addEventListener('receiving-navigate-table', handler);
    return () => window.removeEventListener('receiving-navigate-table', handler);
  }, [handleSelectRow, orderedVisibleRows]);

  // Detail-overlay prev/next: dispatched from `ReceivingDetailsStack` to step
  // through unique `receiving_id`s in the currently-visible history list.
  // Unlike `receiving-navigate-table` (which moves the LINE selection), this
  // navigates by the parent RECEIVING LOG — derives the next unique
  // `receiving_id` in `orderedVisibleRows` and re-opens the overlay for it.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: 'prev' | 'next'; currentReceivingId: number }>).detail;
      if (!detail || (detail.direction !== 'prev' && detail.direction !== 'next')) return;
      if (orderedVisibleRows.length === 0) return;

      const uniqueReceivingIds: number[] = [];
      const seen = new Set<number>();
      for (const row of orderedVisibleRows) {
        const rid = Number(row.receiving_id);
        if (Number.isFinite(rid) && rid > 0 && !seen.has(rid)) {
          seen.add(rid);
          uniqueReceivingIds.push(rid);
        }
      }
      if (uniqueReceivingIds.length === 0) return;

      const step = detail.direction === 'prev' ? -1 : 1;
      const currentIndex = uniqueReceivingIds.indexOf(Number(detail.currentReceivingId));
      const nextIndex = currentIndex < 0 ? 0 : currentIndex + step;
      const nextReceivingId = uniqueReceivingIds[nextIndex];
      if (nextReceivingId == null) return;

      window.dispatchEvent(
        new CustomEvent('receiving-open-details-overlay', {
          detail: { receivingId: nextReceivingId },
        }),
      );
    };
    window.addEventListener('receiving-navigate-detail-overlay', handler);
    return () => window.removeEventListener('receiving-navigate-detail-overlay', handler);
  }, [orderedVisibleRows]);

  // Keep the active row in view when selection changes from sidebar nav.
  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const rowEl = scrollRef.current.querySelector(
      `[data-line-row-id="${selectedId}"]`,
    ) as HTMLElement | null;
    rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const getWeekCount = () =>
    Object.values(filteredGroupedRecords).reduce((sum, rows) => sum + rows.length, 0);

  const emptyMessage = useMemo(
    () => mode.emptyMessage(modeContext),
    [mode, modeContext],
  );

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isIncomingMode ? (
          // Incoming gets its own purpose-built header — title + count +
          // pagination. The sidebar (IncomingSidebarPanel) owns search +
          // facet chips + PO date range + Sort. `total` comes straight
          // from the API response so the "N of M" label stays in sync
          // with whatever filter is applied.
          <IncomingPaneHeader
            count={localRows.length}
            total={isDeliveredUnscannedFacet ? deliveredRows.length : Number(data?.total ?? 0)}
            page={incomingPage}
          />
        ) : (
          <WeekHeader
            count={getWeekCount()}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={() => setWeekOffset(weekOffset + 1)}
            onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          />
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="p-3">
              <SkeletonList count={12} type="row" />
            </div>
          ) : Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-semibold text-gray-500">{emptyMessage}</p>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {Object.entries(filteredGroupedRecords)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dayGroups]) => {
                  // Preserve server ORDER BY for incoming (the Sort control
                  // already drives it); other modes re-sort groups by activity.
                  const sortedGroups = mode.serverSorted
                    ? dayGroups
                    : [...dayGroups].sort(
                        (a, b) => poGroupAnchorMs(b) - poGroupAnchorMs(a),
                      );
                  return (
                    <div key={date} className="flex flex-col">
                      <DateGroupHeader
                        date={date}
                        total={sortedGroups.length}
                      />
                      {sortedGroups.map((group, groupIndex) => {
                        // Single-line PO → render the row flat, exactly as before;
                        // no chevron noise when there's nothing to expand.
                        if (group.rows.length === 1) {
                          const row = group.rows[0];
                          return (
                            <ReceivingLineOrderRow
                              key={row.id}
                              row={row}
                              index={groupIndex}
                              isMobile={isMobile}
                              isIncoming={isIncomingMode}
                              isHistory={isHistoryMode}
                              selectMode={selectMode}
                              isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
                              onSelect={() => handleSelectRow(row)}
                            />
                          );
                        }
                        // Multi-line PO → one collapsed summary row; expand to
                        // reveal the lines. Auto-open in select mode (so the
                        // lines are reachable) or when a child is the active row.
                        const hasSelected = group.rows.some((r) =>
                          selectMode ? selectedIds.has(r.id) : selectedId === r.id,
                        );
                        return (
                          <CollapsibleGroupRow
                            key={group.key}
                            index={groupIndex}
                            showChevron={false}
                            defaultExpanded={selectMode || hasSelected}
                            summary={<ReceivingPoSummary rows={group.rows} isMobile={isMobile} isIncoming={isIncomingMode} isHistory={isHistoryMode} />}
                          >
                            {group.rows.map((row, lineIndex) => (
                              <ReceivingLineOrderRow
                                key={row.id}
                                row={row}
                                index={lineIndex}
                                isMobile={isMobile}
                                isIncoming={isIncomingMode}
                                isHistory={isHistoryMode}
                                selectMode={selectMode}
                                isSelected={selectMode ? selectedIds.has(row.id) : selectedId === row.id}
                                onSelect={() => handleSelectRow(row)}
                              />
                            ))}
                          </CollapsibleGroupRow>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
