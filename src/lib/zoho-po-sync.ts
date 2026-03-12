/**
 * Zoho Purchase Orders → receiving / receiving_lines import library.
 *
 * Each Zoho PO becomes one `receiving` row (carrier = 'ZOHO_PO',
 * qa_status = 'PENDING') representing an expected inbound shipment.
 * Each PO line item becomes a `receiving_lines` row.
 *
 * Rows are keyed by zoho_purchaseorder_id so re-running the sync is safe
 * (existing rows are updated in place).
 *
 * Aligns with Zoho Inventory API v1:
 *   GET /api/v1/purchaseorders        — list
 *   GET /api/v1/purchaseorders/{id}   — detail (includes line_items)
 */

import pool from '@/lib/db';
import { listPurchaseOrders, getPurchaseOrderById } from '@/lib/zoho';
import { formatApiOffsetTimestamp, formatPSTTimestamp, getCurrentPSTDateKey, normalizePSTTimestamp } from '@/utils/date';

type AnyRow = Record<string, unknown>;

function asStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function asPositiveInt(...values: unknown[]): number {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

export type PurchaseOrderImportResult = {
  receiving_id: number;
  zoho_purchaseorder_id: string;
  purchaseorder_number: string | null;
  line_items_imported: number;
  mode: 'created' | 'updated';
};

/**
 * Import / upsert a single Zoho PO into the receiving + receiving_lines tables.
 * If the PO already exists (matched by zoho_purchaseorder_id), it is updated.
 */
export async function importZohoPurchaseOrderToReceiving(
  raw: unknown
): Promise<PurchaseOrderImportResult> {
  const row = raw as AnyRow;
  let zohoId = asStr(row.purchaseorder_id, row.purchase_order_id, row.id);
  if (!zohoId) throw new Error('Missing purchaseorder_id');

  let data = row;

  // Fetch full detail to get line_items (list response omits them)
  if (!Array.isArray(row.line_items)) {
    try {
      const detail = await getPurchaseOrderById(zohoId);
      const inner = (detail as AnyRow)?.purchaseorder;
      if (inner && typeof inner === 'object') {
        data = inner as AnyRow;
        zohoId = asStr(data.purchaseorder_id, zohoId) ?? zohoId;
      }
    } catch {
      // Fall back to list-level data
    }
  }

  const poNumber = asStr(data.purchaseorder_number, data.po_number);
  const vendor = asStr(data.vendor_name);
  const poDate = asStr(data.date, data.purchase_date);
  const normalizedDate = normalizePSTTimestamp(poDate ? `${poDate.substring(0, 10)} 00:00:00` : `${getCurrentPSTDateKey()} 00:00:00`, { fallbackToNow: true })!;
  const warehouseId = asStr(data.warehouse_id);
  const lineItems = Array.isArray(data.line_items) ? data.line_items : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Discover which columns exist on receiving
    const recColsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`
    );
    const recCols = new Set(recColsRes.rows.map((r) => r.column_name));

    const recValues: Record<string, unknown> = {
      receiving_tracking_number: poNumber ?? zohoId,
      carrier: 'ZOHO_PO',
      received_at: normalizedDate,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      is_return: false,
      needs_test: false,
      zoho_warehouse_id: warehouseId,
      updated_at: formatPSTTimestamp(),
    };
    if (recCols.has('date_time')) recValues.date_time = normalizedDate;
    if (recCols.has('zoho_purchaseorder_id')) recValues.zoho_purchaseorder_id = zohoId;
    if (recCols.has('zoho_purchaseorder_number')) recValues.zoho_purchaseorder_number = poNumber;
    // Store vendor in notes field if available
    if (recCols.has('notes') && vendor) recValues.notes = vendor;

    // Check if a receiving row already exists for this PO
    let receivingId: number | null = null;
    let mode: 'created' | 'updated' = 'created';

    if (recCols.has('zoho_purchaseorder_id')) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM receiving WHERE zoho_purchaseorder_id = $1 ORDER BY id DESC LIMIT 1`,
        [zohoId]
      );
      if (existing.rows[0]?.id) {
        receivingId = Number(existing.rows[0].id);
        mode = 'updated';
      }
    }

    if (mode === 'updated' && receivingId) {
      const updates: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const [col, val] of Object.entries(recValues)) {
        if (!recCols.has(col)) continue;
        updates.push(`${col} = $${i++}`);
        vals.push(val);
      }
      vals.push(receivingId);
      if (updates.length > 0) {
        await client.query(
          `UPDATE receiving SET ${updates.join(', ')} WHERE id = $${vals.length}`,
          vals
        );
      }
    } else {
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const [col, val] of Object.entries(recValues)) {
        if (!recCols.has(col)) continue;
        cols.push(col);
        vals.push(val);
      }
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const ins = await client.query<{ id: number }>(
        `INSERT INTO receiving (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      receivingId = Number(ins.rows[0].id);
    }

    // receiving_lines — discover columns
    const hasLinesRes = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving_lines'
       ) AS exists`
    );
    const hasLines = !!hasLinesRes.rows[0]?.exists;
    let insertedLines = 0;

    if (hasLines && receivingId) {
      const lineColsRes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
      );
      const lineCols = new Set(lineColsRes.rows.map((r) => r.column_name));

      // Replace existing lines for this receiving row
      await client.query(`DELETE FROM receiving_lines WHERE receiving_id = $1`, [receivingId]);

      for (const rawLine of lineItems) {
        const line = rawLine as AnyRow;
        if (!line) continue;

        const zohoItemId = asStr(line.item_id);
        const zohoLineItemId = asStr(line.line_item_id, line.id);
        const qty = asPositiveInt(line.quantity, line.quantity_ordered);
        if (!zohoItemId || qty <= 0) continue;

        const lineVals: Record<string, unknown> = {
          receiving_id: receivingId,
          zoho_item_id: zohoItemId,
          zoho_line_item_id: zohoLineItemId,
          zoho_purchaseorder_id: zohoId,
          item_name: asStr(line.name, line.item_name),
          sku: asStr(line.sku),
          quantity: qty,
          quantity_expected: qty,
          quantity_received: asPositiveInt(line.quantity_received, line.received_quantity),
          qa_status: 'PENDING',
          disposition_code: 'HOLD',
          condition_grade: 'BRAND_NEW',
          disposition_audit: '[]',
          notes: asStr(line.description),
        };

        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [col, val] of Object.entries(lineVals)) {
          if (!lineCols.has(col)) continue;
          cols.push(col);
          vals.push(val);
        }
        if (!lineCols.has('quantity') && !lineCols.has('quantity_expected')) continue;
        if (cols.length === 0) continue;

        const placeholders = cols.map((c, i) =>
          c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
        );
        await client.query(
          `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals
        );
        insertedLines++;
      }
    }

    await client.query('COMMIT');
    return {
      receiving_id: receivingId!,
      zoho_purchaseorder_id: zohoId,
      purchaseorder_number: poNumber,
      line_items_imported: insertedLines,
      mode,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type BulkSyncOptions = {
  /** Filter by status: draft | open | billed | cancelled | issued */
  status?: string;
  vendor_id?: string;
  last_modified_time?: string;
  /** Days back from now if last_modified_time not set; 0 = all time */
  days_back?: number;
  per_page?: number;
  max_pages?: number;
  max_items?: number;
};

export type BulkSyncSummary = {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ purchaseorder_id: string; error: string }>;
};

/**
 * Page through all matching Zoho POs and upsert them into receiving / receiving_lines.
 */
export async function syncZohoPurchaseOrdersToReceiving(
  opts: BulkSyncOptions = {}
): Promise<BulkSyncSummary> {
  const perPage = Math.min(200, Math.max(1, Number(opts.per_page) || 200));
  const maxPages = Math.min(100, Math.max(1, Number(opts.max_pages) || 50));
  const maxItems = Math.min(10000, Math.max(1, Number(opts.max_items) || 5000));

  let lastModifiedTime = String(opts.last_modified_time || '').trim() || undefined;
  if (!lastModifiedTime && opts.days_back && Number(opts.days_back) > 0) {
    const cutoff = new Date(Date.now() - Number(opts.days_back) * 24 * 60 * 60 * 1000);
    lastModifiedTime = formatApiOffsetTimestamp(cutoff);
  }

  const summary: BulkSyncSummary = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (let page = 1; page <= maxPages && summary.processed < maxItems; page++) {
    const data = await listPurchaseOrders({
      page,
      per_page: perPage,
      status: opts.status || undefined,
      vendor_id: opts.vendor_id || undefined,
      last_modified_time: lastModifiedTime,
    });

    const rows = (data as AnyRow).purchaseorders;
    const pos = Array.isArray(rows) ? rows : [];
    if (pos.length === 0) break;

    for (const po of pos) {
      if (summary.processed >= maxItems) break;
      summary.processed++;

      const poRow = po as AnyRow;
      const zohoId =
        asStr(poRow.purchaseorder_id, poRow.purchase_order_id, poRow.id) ?? 'unknown';

      try {
        const result = await importZohoPurchaseOrderToReceiving(po);
        if (result.mode === 'created') summary.created++;
        else summary.updated++;
      } catch (err: unknown) {
        summary.failed++;
        if (summary.errors.length < 50) {
          summary.errors.push({
            purchaseorder_id: zohoId,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    const pageCtx = (data as AnyRow)?.page_context as AnyRow | undefined;
    const hasMore = Boolean(pageCtx?.has_more_page);
    if (!hasMore) break;
  }

  return summary;
}
