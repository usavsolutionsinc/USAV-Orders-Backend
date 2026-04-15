/**
 * Canonical Zoho inbound sync service.
 *
 * Data model:
 *   receiving       — physical package arrivals scanned at the dock.
 *   receiving_lines — authoritative inbound line items sourced from Zoho.
 *
 * This module keeps expected inbound state in receiving_lines and only links a
 * physical receiving row when the warehouse has actually scanned a package.
 */

import pool from '@/lib/db';
import { getPurchaseOrderById, getPurchaseReceiveById, listPurchaseOrders } from '@/lib/zoho';
import { formatApiOffsetTimestamp, formatPSTTimestamp } from '@/utils/date';
import type { PoolClient } from 'pg';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

type AnyRow = Record<string, unknown>;
type WorkflowStatus = 'EXPECTED' | 'MATCHED';

function asObject(value: unknown): AnyRow | null {
  return value && typeof value === 'object' ? (value as AnyRow) : null;
}

function asString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function asPositiveInt(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

function getZohoLastModifiedTime(row: AnyRow): string | null {
  return asString(
    row.last_modified_time,
    row.last_modified_at,
    row.updated_time,
    row.modified_time,
    row.created_time
  );
}

async function getReceivingLineColumns(client: PoolClient) {
  const lineColsRes = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
  );
  return new Set(lineColsRes.rows.map((r) => r.column_name));
}

type SyncPOLinesOptions = {
  receivingId?: number | null;
  workflowStatus?: WorkflowStatus;
};

type SyncPOLinesResult = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  line_items_synced: number;
  line_items_skipped: number;
  line_items_linked: number;
  mode: 'inserted' | 'updated';
};

async function syncPurchaseOrderLines(
  client: PoolClient,
  purchaseOrderId: string,
  options: SyncPOLinesOptions = {}
): Promise<SyncPOLinesResult> {
  const poId = asString(purchaseOrderId);
  if (!poId) throw new Error('purchaseorder_id is required');

  const detail = await getPurchaseOrderById(poId);
  const po = asObject((detail as AnyRow)?.purchaseorder);
  if (!po) throw new Error(`Zoho purchase order not found: ${poId}`);

  const normalizedPoId = asString(po.purchaseorder_id, poId) || poId;
  const poNumber = asString(po.purchaseorder_number) || normalizedPoId;
  const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
  const lineCols = await getReceivingLineColumns(client);

  // Zoho PO Reference# carries the tracking number per the inbound contract.
  // Register it in shipping_tracking_numbers once per PO so receiving rows can
  // link via receiving.shipment_id (canonical, replaces the legacy
  // receiving_lines.zoho_reference_number text column).
  const poReference = asString(po.reference_number);
  let shipmentId: number | null = null;
  if (poReference) {
    const shipment = await registerShipmentPermissive({
      trackingNumber: poReference,
      sourceSystem: 'zoho_po',
    });
    shipmentId = shipment?.id ?? null;
  }

  let synced = 0;
  let skipped = 0;
  let linked = 0;
  let mode: 'inserted' | 'updated' = 'inserted';
  const workflowStatus = options.receivingId ? (options.workflowStatus || 'MATCHED') : 'EXPECTED';
  const syncedAt = formatPSTTimestamp();
  const lastModifiedTime = getZohoLastModifiedTime(po);

  for (const rawLine of lineItems) {
    const line = asObject(rawLine);
    if (!line) {
      skipped++;
      continue;
    }

    const zohoItemId = asString(line.item_id);
    const zohoLineItemId = asString(line.line_item_id, line.id);
    const quantityExpected = asPositiveInt(line.quantity);
    if (!zohoItemId || quantityExpected <= 0) {
      skipped++;
      continue;
    }

    const existing = (lineCols.has('zoho_purchaseorder_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId)
      ? await client.query<{ id: number; receiving_id: number | null }>(
          `SELECT id, receiving_id
           FROM receiving_lines
           WHERE zoho_purchaseorder_id = $1
             AND zoho_line_item_id = $2
           LIMIT 1`,
          [normalizedPoId, zohoLineItemId]
        )
      : { rows: [] as Array<{ id: number; receiving_id: number | null }> };

    const existingRow = existing.rows[0] ?? null;
    const desiredReceivingId =
      options.receivingId && (!existingRow?.receiving_id || existingRow.receiving_id === options.receivingId)
        ? options.receivingId
        : existingRow?.receiving_id ?? null;

    const lineValues: Record<string, unknown> = {
      zoho_item_id: zohoItemId,
      zoho_line_item_id: zohoLineItemId,
      zoho_purchaseorder_id: normalizedPoId,
      zoho_purchaseorder_number: poNumber,
      item_name: asString(line.name, line.item_name),
      sku: asString(line.sku),
      quantity_received: 0,
      quantity_expected: quantityExpected,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      disposition_audit: JSON.stringify([]),
      notes: asString(line.description),
      workflow_status: workflowStatus,
      receiving_id: desiredReceivingId,
      zoho_sync_source: 'purchase_order',
      zoho_last_modified_time: lastModifiedTime,
      zoho_synced_at: syncedAt,
    };

    if (existingRow) {
      const updatable = [
        'zoho_item_id',
        'zoho_line_item_id',
        'zoho_purchaseorder_number',
        'item_name',
        'sku',
        'quantity_expected',
        'notes',
        'zoho_sync_source',
        'zoho_last_modified_time',
        'zoho_synced_at',
      ];
      if (options.receivingId && !existingRow.receiving_id) {
        updatable.push('receiving_id', 'workflow_status');
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const col of updatable) {
        if (!lineCols.has(col)) continue;
        sets.push(`${col} = $${i++}`);
        vals.push(lineValues[col]);
      }
      if (sets.length > 0) {
        vals.push(existingRow.id);
        await client.query(`UPDATE receiving_lines SET ${sets.join(', ')} WHERE id = $${i}`, vals);
        mode = 'updated';
      }
      if (options.receivingId && !existingRow.receiving_id) linked++;
    } else {
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const [col, val] of Object.entries(lineValues)) {
        if (!lineCols.has(col)) continue;
        cols.push(col);
        vals.push(col === 'disposition_audit' ? `${val}` : val);
      }
      if (cols.length === 0) {
        skipped++;
        continue;
      }

      const placeholders = cols.map((c, i) =>
        c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
      );
      await client.query(
        `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      );
      if (options.receivingId) linked++;
    }

    synced++;
  }

  // Attach the PO's canonical shipment to the physical receiving row (idempotent).
  // COALESCE preserves a shipment_id set earlier by a scan/lookup writer.
  if (options.receivingId && shipmentId != null) {
    await client.query(
      `UPDATE receiving
          SET shipment_id = COALESCE(shipment_id, $1)
        WHERE id = $2`,
      [shipmentId, options.receivingId],
    );
  }

  return {
    purchaseorder_id: normalizedPoId,
    purchaseorder_number: poNumber,
    line_items_synced: synced,
    line_items_skipped: skipped,
    line_items_linked: linked,
    mode,
  };
}

export type ImportPOResult = SyncPOLinesResult;

/**
 * Sync all line items from a single Zoho Purchase Order into receiving_lines.
 * When receivingId is provided, any still-unmatched lines are linked to that
 * physical receiving row and moved to MATCHED.
 */
export async function importZohoPurchaseOrderToReceiving(
  purchaseOrderId: string,
  options: SyncPOLinesOptions = {}
): Promise<ImportPOResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await syncPurchaseOrderLines(client, purchaseOrderId, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export type BulkSyncOptions = {
  status?: string;
  vendor_id?: string;
  last_modified_time?: string;
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
  linked: number;
  line_items_synced: number;
  errors: Array<{ purchaseorder_id: string; error: string }>;
};

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
  if (!lastModifiedTime && !opts.days_back) {
    const cursor = await getSyncCursor('zoho_purchase_orders');
    if (cursor) {
      lastModifiedTime = formatApiOffsetTimestamp(cursor);
    }
  }

  const summary: BulkSyncSummary = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    linked: 0,
    line_items_synced: 0,
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
        asString(poRow.purchaseorder_id, poRow.purchase_order_id, poRow.id) ?? 'unknown';

      try {
        const result = await importZohoPurchaseOrderToReceiving(zohoId);
        summary.line_items_synced += result.line_items_synced;
        summary.linked += result.line_items_linked;
        if (result.mode === 'inserted') summary.created++;
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

  if (summary.failed === 0) {
    await updateSyncCursor('zoho_purchase_orders', new Date()).catch(() => {});
  }

  return summary;
}

// Legacy: import by Purchase Receive for backward compatibility.

export type ImportResult = {
  purchase_receive_id: string;
  line_items_synced: number;
  line_items_skipped: number;
  mode: 'inserted' | 'updated';
};

export async function importZohoPurchaseReceiveToReceiving(options: {
  purchaseReceiveId: string;
  receivedBy?: number | null;
  assignedTechId?: number | null;
  needsTest?: boolean;
  targetChannel?: string | null;
}): Promise<ImportResult> {
  const receiveIdInput = asString(options.purchaseReceiveId);
  if (!receiveIdInput) throw new Error('purchase_receive_id is required');

  const detail = await getPurchaseReceiveById(receiveIdInput);
  const receive = asObject((detail as AnyRow)?.purchasereceive);
  if (!receive) throw new Error('Zoho purchase receive not found');

  const normalizedReceiveId =
    asString(receive.purchase_receive_id, receive.receive_id, receive.id, receiveIdInput) ||
    receiveIdInput;

  const lineItems = Array.isArray(receive.line_items) ? receive.line_items : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineCols = await getReceivingLineColumns(client);
    let synced = 0;
    let skipped = 0;
    let mode: 'inserted' | 'updated' = 'inserted';
    const syncedAt = formatPSTTimestamp();
    const lastModifiedTime = getZohoLastModifiedTime(receive);

    for (const rawLine of lineItems) {
      const line = asObject(rawLine);
      if (!line) {
        skipped++;
        continue;
      }

      const zohoItemId = asString(line.item_id);
      const zohoLineItemId = asString(line.line_item_id, line.id);
      const qty = asPositiveInt(line.quantity, line.accepted_quantity, line.quantity_received);
      if (!zohoItemId || qty <= 0) {
        skipped++;
        continue;
      }

      const existing = (lineCols.has('zoho_purchase_receive_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId)
        ? await client.query<{ id: number }>(
            `SELECT id FROM receiving_lines
             WHERE zoho_purchase_receive_id = $1
               AND zoho_line_item_id = $2
             LIMIT 1`,
            [normalizedReceiveId, zohoLineItemId]
          )
        : { rows: [] as Array<{ id: number }> };

      const existingId = existing.rows[0]?.id ?? null;
      const lineValues: Record<string, unknown> = {
        zoho_item_id: zohoItemId,
        zoho_line_item_id: zohoLineItemId,
        zoho_purchase_receive_id: normalizedReceiveId,
        zoho_purchaseorder_id: asString(receive.purchaseorder_id),
        zoho_purchaseorder_number: asString(receive.purchaseorder_number),
        item_name: asString(line.name, line.item_name),
        sku: asString(line.sku),
        quantity_received: qty,
        quantity_expected: asPositiveInt(line.quantity),
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
        condition_grade: 'BRAND_NEW',
        disposition_audit: JSON.stringify([]),
        notes: null,
        zoho_sync_source: 'purchase_receive',
        zoho_last_modified_time: lastModifiedTime,
        zoho_synced_at: syncedAt,
      };

      if (existingId) {
        const updatable = [
          'zoho_item_id',
          'zoho_purchaseorder_id',
          'zoho_purchaseorder_number',
          'item_name',
          'sku',
          'quantity_received',
          'quantity_expected',
          'notes',
          'zoho_sync_source',
          'zoho_last_modified_time',
          'zoho_synced_at',
        ];
        const sets: string[] = [];
        const vals: unknown[] = [];
        let i = 1;
        for (const col of updatable) {
          if (!lineCols.has(col)) continue;
          sets.push(`${col} = $${i++}`);
          vals.push(lineValues[col]);
        }
        if (sets.length > 0) {
          vals.push(existingId);
          await client.query(`UPDATE receiving_lines SET ${sets.join(', ')} WHERE id = $${i}`, vals);
          mode = 'updated';
        }
      } else {
        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [col, val] of Object.entries(lineValues)) {
          if (!lineCols.has(col)) continue;
          cols.push(col);
          vals.push(col === 'disposition_audit' ? `${val}` : val);
        }
        if (cols.length === 0) {
          skipped++;
          continue;
        }

        const placeholders = cols.map((c, i) =>
          c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
        );
        await client.query(
          `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals
        );
      }
      synced++;
    }

    await client.query('COMMIT');
    return {
      purchase_receive_id: normalizedReceiveId,
      line_items_synced: synced,
      line_items_skipped: skipped,
      mode,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
