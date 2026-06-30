import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/**
 * Package-grouping + config-driven field model for the mobile receiving feed.
 *
 * The feed query returns a flat, newest-first list of {@link ReceivingLineRow}.
 * This module collapses lines that share an inbound carton (`receiving_id`) into
 * a single `package` entry so one parcel's units read as a set, and leaves
 * solitary lines as standalone `unit` entries. Grouping is pure + presentational
 * — it never touches the data layer, so it composes on top of the existing
 * windowing/scroll/fresh mechanics in {@link useFeedWindow}.
 *
 * Display-only: a unit's detail panel renders from `buildUnitFields(row)` (the
 * `pin` flag, not JSX, decides what shows collapsed) so adding/removing a
 * surfaced field stays a data change. See the migration plan §4 / §8.
 */

interface ReceivingFeedField {
  k: string;
  v: string;
}

export type ReceivingFeedEntry =
  | {
      kind: 'package';
      /** Stable react key — the carton id. */
      key: string;
      /** Display label, e.g. "PKG·2" (sequential within the visible feed). */
      label: string;
      po: string;
      /** Full tracking; render masked via {@link maskTracking}. */
      trk: string;
      carrier: string;
      items: ReceivingLineRow[];
    }
  | {
      kind: 'unit';
      key: string;
      unit: ReceivingLineRow;
    };

/** The product title SoT order — catalog title › Zoho item title › PO line name › id. */
export function unitTitle(row: ReceivingLineRow): string {
  return (
    row.catalog_product_title ||
    row.zoho_item_title ||
    row.item_name ||
    row.zoho_item_id ||
    'Unnamed inbound line'
  );
}

function unitPo(row: ReceivingLineRow): string {
  return (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').toString().trim();
}

/**
 * Group a newest-first line list into package + unit entries.
 *
 * - Lines sharing a non-null `receiving_id` collapse into one `package` entry
 *   (only when 2+ lines share it — a carton of one renders as a plain `unit`
 *   card per decision D2). Carton order follows first appearance, so the
 *   newest-active carton stays first (matching the `unboxed_newest` sort).
 * - The package's shared PO/tracking/carrier come from its first line; per-line
 *   overrides still surface on each unit's own meta/detail.
 */
export function groupReceivingEntries(rows: ReadonlyArray<ReceivingLineRow>): ReceivingFeedEntry[] {
  // Pass 1: gather all lines per carton so a package knows its full item set.
  const byCarton = new Map<number, ReceivingLineRow[]>();
  for (const row of rows) {
    if (row.receiving_id == null) continue;
    const existing = byCarton.get(row.receiving_id);
    if (existing) existing.push(row);
    else byCarton.set(row.receiving_id, [row]);
  }

  // Pass 2: re-walk source order so package + unit entries interleave by their
  // first line's position (keeps the feed chronologically stable). A carton of
  // one renders as a plain unit card (decision D2).
  const emitted = new Set<number>();
  const entries: ReceivingFeedEntry[] = [];
  let pkgSeq = 0;

  for (const row of rows) {
    if (row.receiving_id == null) {
      entries.push({ kind: 'unit', key: `u-${row.id}`, unit: row });
      continue;
    }
    if (emitted.has(row.receiving_id)) continue;
    emitted.add(row.receiving_id);
    const items = byCarton.get(row.receiving_id) ?? [row];
    if (items.length < 2) {
      entries.push({ kind: 'unit', key: `u-${items[0].id}`, unit: items[0] });
      continue;
    }
    pkgSeq += 1;
    const head = items[0];
    entries.push({
      kind: 'package',
      key: `p-${row.receiving_id}`,
      label: `PKG·${pkgSeq}`,
      po: unitPo(head),
      trk: (head.tracking_number || '').trim(),
      carrier: (head.carrier || '').trim(),
      items,
    });
  }

  return entries;
}

/**
 * Config-driven *non-identifier* detail fields for a unit. Order here is render
 * order; the detail panel loops this and never names a field in JSX. Identifiers
 * (PO / SKU / tracking / serial) are NOT included — those render through the
 * shared CopyChip family (last-4 + copy-on-tap), the SoT for identifier display.
 */
export function buildUnitFields(row: ReceivingLineRow): ReceivingFeedField[] {
  const fields: ReceivingFeedField[] = [];
  const push = (k: string, v: string | null | undefined) => {
    const val = (v ?? '').toString().trim();
    if (val) fields.push({ k, v: val });
  };

  // Identifiers (PO / SKU / tracking / serial) render as CopyChips, and price /
  // condition live on the meta row — so the only free-text field left is Notes.
  push('Notes', row.notes);

  return fields;
}
