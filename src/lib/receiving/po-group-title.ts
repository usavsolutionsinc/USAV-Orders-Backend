/**
 * PO-group display title — shared by {@link ReceivingPoSummary} (collapsed PO
 * rows in the receiving table) and receiving sidebar rails.
 * Title = platform · buyer account · PO/Order when multi-SKU; product title when single-SKU.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export interface ReceivingPoIdentityParts {
  poValue: string;
  idPrefix: 'PO' | 'Order';
  platformLabel: string;
  accountLabel: string;
}

/** Stamped by rail fetchers before render — drives adaptive title mode. */
export interface RailTitleContext {
  line_count: number;
  distinct_sku_count: number;
}

/** Identity fields shared by the PO summary title and its PO chip column. */
export function getReceivingPoIdentityParts(
  row: ReceivingLineRow,
  resolvePlatformLabel: (raw: string) => string,
): ReceivingPoIdentityParts {
  const inboundSource = (row.inbound_source_type || '').trim().toLowerCase();
  const isMarketplacePurchase = inboundSource !== '' && inboundSource !== 'zoho';
  const poValue = (
    row.zoho_purchaseorder_number ||
    row.zoho_purchaseorder_id ||
    (isMarketplacePurchase ? row.source_order_id : '') ||
    ''
  ).trim();
  const idPrefix: 'PO' | 'Order' =
    !row.zoho_purchaseorder_id && isMarketplacePurchase ? 'Order' : 'PO';
  const platformRaw = (row.source_platform || inboundSource || '').trim().toLowerCase();
  const platformLabel = platformRaw ? resolvePlatformLabel(platformRaw) : '';
  const accountLabel = (row.platform_account_label || '').trim();
  return { poValue, idPrefix, platformLabel, accountLabel };
}

/** Collapsed-PO / carton-level title — mirrors ReceivingPoSummary. */
export function getReceivingPoGroupTitle(
  row: ReceivingLineRow,
  resolvePlatformLabel: (raw: string) => string,
): string {
  const { poValue, idPrefix, platformLabel, accountLabel } = getReceivingPoIdentityParts(
    row,
    resolvePlatformLabel,
  );
  return (
    [platformLabel, accountLabel, poValue ? `${idPrefix} ${poValue}` : '']
      .filter(Boolean)
      .join(' · ') || (row.item_name ?? 'Grouped lines')
  );
}

/** True when the row should read as a matched PO/order identity, not a product line. */
export function isReceivingPoGroupTitleRow(row: ReceivingLineRow): boolean {
  if (row.receiving_source === 'unmatched') return false;
  if ((row.item_name || '').trim() === 'Unfound PO') return false;
  const { poValue } = getReceivingPoIdentityParts(row, () => '');
  return poValue.length > 0;
}

/** PO grouping key — mirrors {@link useReceivingGrouping}. */
export function receivingPoGroupKey(row: ReceivingLineRow): string {
  const po = (
    row.zoho_purchaseorder_number ||
    row.zoho_purchaseorder_id ||
    ''
  ).trim();
  if (po) return `po:${po}`;
  const src = (row.inbound_source_type || '').trim().toLowerCase();
  const orderId = (row.source_order_id || '').trim();
  if (src && orderId) return `src:${src}:${orderId}`;
  return `line:${row.id}`;
}

/** Distinct product identity for adaptive title (SKU preferred, else item name). */
function lineProductKey(row: ReceivingLineRow): string {
  const sku = (row.sku || '').trim().toLowerCase();
  if (sku) return `sku:${sku}`;
  const item = (row.item_name || row.zoho_item_id || '').trim().toLowerCase();
  if (item) return `item:${item}`;
  return `line:${row.id}`;
}

/** Count lines + distinct product keys in a group. */
export function countLinesAndSkus(rows: ReadonlyArray<ReceivingLineRow>): RailTitleContext {
  const keys = new Set(rows.map(lineProductKey));
  return {
    line_count: rows.length,
    distinct_sku_count: keys.size,
  };
}

/** Stamp PO-level title context on every row (door-scan feeds). */
export function stampPoRailTitleContext(rows: ReceivingLineRow[]): ReceivingLineRow[] {
  const byPo = new Map<string, ReceivingLineRow[]>();
  for (const r of rows) {
    const key = receivingPoGroupKey(r);
    const list = byPo.get(key) ?? [];
    list.push(r);
    byPo.set(key, list);
  }
  return rows.map((r) => ({
    ...r,
    rail_title_context: countLinesAndSkus(byPo.get(receivingPoGroupKey(r)) ?? [r]),
  }));
}

/** Stamp carton-level title context on deduped representative rows (unbox Recent). */
export function stampCartonRailTitleContext(
  allRows: ReadonlyArray<ReceivingLineRow>,
  representatives: ReceivingLineRow[],
): ReceivingLineRow[] {
  const byCarton = new Map<number, ReceivingLineRow[]>();
  for (const r of allRows) {
    const rid = r.receiving_id;
    if (rid == null || !Number.isFinite(Number(rid))) continue;
    const list = byCarton.get(rid) ?? [];
    list.push(r);
    byCarton.set(rid, list);
  }
  return representatives.map((r) => {
    const rid = r.receiving_id;
    if (rid == null) return r;
    const group = byCarton.get(rid) ?? [r];
    return { ...r, rail_title_context: countLinesAndSkus(group) };
  });
}

/** Operator-recognition product title — aligned with mobile `unitTitle`. */
export function receivingProductTitle(row: ReceivingLineRow): string {
  return (
    row.catalog_product_title ||
    row.zoho_item_title ||
    row.item_name ||
    row.sku ||
    row.zoho_item_id ||
    `Line #${row.id}`
  );
}

/** True when adaptive mode should show PO summary instead of product title. */
export function shouldUsePoGroupRailTitle(row: ReceivingLineRow): boolean {
  const ctx = row.rail_title_context;
  if (!ctx) return false;
  return (
    ctx.line_count > 1 &&
    ctx.distinct_sku_count > 1 &&
    isReceivingPoGroupTitleRow(row)
  );
}

export type ReceivingRailRowTitleMode = 'line' | 'po-group' | 'adaptive-po';

/** Adaptive rail title — product name for single-SKU; PO summary for multi distinct SKU. */
export function receivingAdaptiveRailTitle(
  row: ReceivingLineRow,
  resolvePlatformLabel: (raw: string) => string,
): string {
  if (!isReceivingPoGroupTitleRow(row)) {
    return receivingProductTitle(row);
  }
  if (shouldUsePoGroupRailTitle(row)) {
    return getReceivingPoGroupTitle(row, resolvePlatformLabel);
  }
  return receivingProductTitle(row);
}

/** Rail row label — line-level, always PO-group, or adaptive. */
export function receivingRailRowTitle(
  row: ReceivingLineRow,
  rowTitleMode: ReceivingRailRowTitleMode,
  resolvePlatformLabel: (raw: string) => string,
): string {
  if (rowTitleMode === 'adaptive-po') {
    return receivingAdaptiveRailTitle(row, resolvePlatformLabel);
  }
  if (rowTitleMode === 'po-group' && isReceivingPoGroupTitleRow(row)) {
    return getReceivingPoGroupTitle(row, resolvePlatformLabel);
  }
  if (rowTitleMode === 'line') {
    return receivingProductTitle(row);
  }
  return row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
}
