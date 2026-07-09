/**
 * Station-log → TSV copy formatters (station-table-unification-plan §5.4 / §7).
 * The bulk "Copy" action on the Tech / Packer tables serializes the selected
 * rows to tab-separated lines (paste into a sheet). Pure + column-stable so the
 * output is predictable regardless of row order.
 */
import type { TechRecord } from '@/hooks/useTechLogs';
import type { PackerRecord } from '@/hooks/usePackerLogs';

/** Tab-join, normalizing nullish/whitespace cells to '' so columns stay aligned. */
function tsv(cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t');
}

export const TECH_COPY_HEADER = ['Date', 'Order', 'SKU', 'Serial', 'Tracking', 'Qty', 'Condition', 'Title'];
export function formatTechCopyRow(r: TechRecord): string {
  return tsv([
    r.created_at,
    r.order_id,
    r.sku,
    r.serial_number,
    r.shipping_tracking_number,
    r.quantity ?? '1',
    r.condition,
    r.product_title,
  ]);
}

export const PACKER_COPY_HEADER = ['Date', 'Order', 'SKU', 'Scan', 'Tracking', 'Qty', 'Condition', 'Title'];
export function formatPackerCopyRow(r: PackerRecord): string {
  return tsv([
    r.created_at,
    r.order_id,
    r.sku,
    r.scan_ref,
    r.shipping_tracking_number,
    r.quantity ?? '1',
    r.condition,
    r.product_title,
  ]);
}

/** Prepend a header row to a set of TSV lines (full clipboard block). */
export function toTsvBlock(header: string[], lines: string[]): string {
  return [header.join('\t'), ...lines].join('\n');
}
