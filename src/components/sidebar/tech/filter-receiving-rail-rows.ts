import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Client-side filter for tech sidebar rails — tokenized substring match. */
export function filterReceivingRailRows(rows: ReceivingLineRow[], query: string): ReceivingLineRow[] {
  const trimmed = query.trim();
  if (!trimmed) return rows;
  const tokens = trimmed.toLowerCase().split(/\s+/);
  return rows.filter((row) => {
    const haystack = [
      row.item_name,
      row.sku,
      row.tracking_number,
      row.zoho_purchaseorder_number,
      row.zoho_purchaseorder_id,
      row.zoho_item_id,
      row.workflow_status,
      row.receiving_source,
      String(row.id),
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return tokens.every((token) => haystack.includes(token));
  });
}
