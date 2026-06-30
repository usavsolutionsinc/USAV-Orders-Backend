/**
 * Receiving sidebar-rail quantity logic — per-feed "how does this row count?"
 * rendered into the rail row's meta and the hover-popover progress meter.
 *
 * Four strategies, one per quantity semantic the receiving rails use. These
 * collapse the inline `{expected ?? 1}/{expected ?? '?'}` literal that was
 * copy-pasted across ReceivingRecentRail / ReceivingScannedRail /
 * TriageCombinedList into one place:
 *   - `received` → Unboxed / Viewed: real received/expected (emerald when full).
 *     Unfound-not-yet-unboxed stays 0/?.
 *   - `scanned`  → Queue / Prioritize: a door scan brings the WHOLE carton in,
 *     so scanned == expected ("1/1", never "0/1").
 *   - `unfound`  → Unfound stubs: nothing received yet (0/?).
 *   - `combined` → Triage union: branch unmatched→unfound, else→scanned.
 *
 * This is row-cell formatting logic, not the rail's display shell — the row
 * anatomy + popover live in RecentActivityRailBase and are untouched.
 */

import type { ReactNode } from 'react';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** { current, total } for the hover-popover progress meter. */
export interface RailPreviewQty {
  current: number;
  total: number | null;
}

/** Inline quantity for the Unboxed + Viewed rails — always real received/expected. */
function renderReceivedQty(row: ReceivingLineRow): ReactNode {
  const expected = row.quantity_expected;
  return (
    <span
      className={
        expected != null && row.quantity_received >= expected
          ? 'text-emerald-600'
          : 'text-gray-600'
      }
    >
      {row.quantity_received}/{expected ?? '?'}
    </span>
  );
}

/**
 * SCANNED semantics — every row in the view=scanned feed has
 * quantity_received = 0 by definition (it drops out the instant it's unboxed), so
 * a door scan brings the WHOLE carton in physically: scanned == expected.
 * Falls back to 1/? when the expected qty is unknown.
 */
function renderScannedQty(row: ReceivingLineRow): ReactNode {
  const expected = row.quantity_expected;
  return (
    <span className="text-gray-600">
      {expected ?? 1}/{expected ?? '?'}
    </span>
  );
}

/** Unfound stubs carry 0/? (nothing received yet). */
function renderUnfoundQty(row: ReceivingLineRow): ReactNode {
  return (
    <span className="text-gray-600">
      {row.quantity_received}/{row.quantity_expected ?? '?'}
    </span>
  );
}

/** Triage union: unmatched stubs read as unfound, matched scanned cartons as scanned. */
function renderCombinedQty(row: ReceivingLineRow): ReactNode {
  return row.receiving_source === 'unmatched' ? renderUnfoundQty(row) : renderScannedQty(row);
}

const receivedPreview = (row: ReceivingLineRow): RailPreviewQty => ({
  current: row.quantity_received,
  total: row.quantity_expected,
});
const scannedPreview = (row: ReceivingLineRow): RailPreviewQty => ({
  current: row.quantity_expected ?? 1,
  total: row.quantity_expected,
});

/**
 * Quantity-strategy registry. A rail feed selects one by id; the row renderer,
 * popover label, and popover progress values are resolved here.
 */
export const RAIL_QTY = {
  received: {
    previewQtyLabel: 'Received',
    renderQuantity: renderReceivedQty,
    getPreviewQty: receivedPreview,
  },
  scanned: {
    previewQtyLabel: 'Scanned',
    renderQuantity: renderScannedQty,
    getPreviewQty: scannedPreview,
  },
  unfound: {
    previewQtyLabel: 'Received',
    renderQuantity: renderUnfoundQty,
    getPreviewQty: receivedPreview,
  },
  combined: {
    previewQtyLabel: 'Scanned',
    renderQuantity: renderCombinedQty,
    getPreviewQty: (row: ReceivingLineRow): RailPreviewQty =>
      row.receiving_source === 'unmatched' ? receivedPreview(row) : scannedPreview(row),
  },
} as const;

export type RailQtyId = keyof typeof RAIL_QTY;
