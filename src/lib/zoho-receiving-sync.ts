/**
 * Zoho → receiving_lines sync
 *
 * Data model:
 *   receiving       — physical package arrivals (tracking scans at the dock, Mode1/Mode2).
 *                     Populated ONLY by warehouse scans, NOT by this module.
 *   receiving_lines — expected line items from Zoho Purchase Orders.
 *                     receiving_id is NULL until a physical scan is matched/unboxed.
 *
 * This module only writes to receiving_lines.
 */

import pool from '@/lib/db';
import { getPurchaseReceiveById, getPurchaseOrderById } from '@/lib/zoho';

type AnyRow = Record<string, unknown>;

function asObject(value: unknown): AnyRow | null {
  return value && typeof value === 'object' ? (value as AnyRow) : null;
}

function asString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
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

// ─── Import by Purchase Order ─────────────────────────────────────────────────

export type ImportPOResult = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  line_items_synced: number;
  line_items_skipped: number;
  mode: 'inserted' | 'updated';
};

/**
 * Syncs all line items from a single Zoho Purchase Order into receiving_lines.
 * - receiving_id is left NULL (physical scans assign it later).
 * - Upserts by (zoho_purchaseorder_id, zoho_line_item_id) so it's idempotent.
 * - No rows are created in the receiving table.
 */
export async function importZohoPurchaseOrderToReceiving(
  purchaseOrderId: string
): Promise<ImportPOResult> {
  const poId = asString(purchaseOrderId);
  if (!poId) throw new Error('purchaseorder_id is required');

  const detail = await getPurchaseOrderById(poId);
  const po = asObject((detail as AnyRow)?.purchaseorder);
  if (!po) throw new Error(`Zoho purchase order not found: ${poId}`);

  const normalizedPoId = asString(po.purchaseorder_id, poId) || poId;
  const poNumber = asString(po.purchaseorder_number) || normalizedPoId;

  const lineItems = Array.isArray(po.line_items) ? po.line_items : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Introspect receiving_lines columns so we gracefully handle any schema drift
    const lineColsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
    );
    const lineCols = new Set(lineColsRes.rows.map((r) => r.column_name));

    let synced = 0;
    let skipped = 0;
    let mode: 'inserted' | 'updated' = 'inserted';

    for (const rawLine of lineItems) {
      const line = asObject(rawLine);
      if (!line) { skipped++; continue; }

      const zohoItemId = asString(line.item_id);
      const zohoLineItemId = asString(line.line_item_id, line.id);
      // Zoho PO: quantity = ordered qty; quantity_received = already received qty
      const quantityExpected = asPositiveInt(line.quantity);

      if (!zohoItemId || quantityExpected <= 0) { skipped++; continue; }

      // Check for an existing row for this PO + line item
      let existingId: number | null = null;
      if (lineCols.has('zoho_purchaseorder_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId) {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM receiving_lines
           WHERE zoho_purchaseorder_id = $1 AND zoho_line_item_id = $2
           LIMIT 1`,
          [normalizedPoId, zohoLineItemId]
        );
        existingId = existing.rows[0]?.id ?? null;
      }

      const lineValues: Record<string, unknown> = {
        // receiving_id intentionally omitted — stays NULL until physical scan
        zoho_item_id: zohoItemId,
        zoho_line_item_id: zohoLineItemId,
        zoho_purchaseorder_id: normalizedPoId,
        item_name: asString(line.name, line.item_name),
        sku: asString(line.sku),
        quantity_received: 0,
        quantity_expected: quantityExpected,
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
        condition_grade: 'BRAND_NEW',
        disposition_audit: JSON.stringify([]),
        notes: asString(line.description),
      };

      if (existingId) {
        // Update mutable fields only; don't touch receiving_id or qa_status if already worked
        const updatable = ['zoho_item_id', 'item_name', 'sku', 'quantity_expected', 'notes', 'zoho_line_item_id'];
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
        // Insert new row
        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [col, val] of Object.entries(lineValues)) {
          if (!lineCols.has(col)) continue;
          cols.push(col);
          vals.push(col === 'disposition_audit' ? `${val}` : val);
        }
        if (cols.length === 0) { skipped++; continue; }

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
      purchaseorder_id: normalizedPoId,
      purchaseorder_number: poNumber,
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

// ─── Legacy: Import by Purchase Receive ──────────────────────────────────────
// (kept for backward compat with /api/zoho/purchase-receives/import)

export type ImportResult = {
  purchase_receive_id: string;
  line_items_synced: number;
  line_items_skipped: number;
  mode: 'inserted' | 'updated';
};

/**
 * Syncs line items from a single Zoho Purchase Receive into receiving_lines.
 * receiving_id is left NULL — matched to a physical scan by Mode2 unboxing.
 */
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

    const lineColsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
    );
    const lineCols = new Set(lineColsRes.rows.map((r) => r.column_name));

    let synced = 0;
    let skipped = 0;
    let mode: 'inserted' | 'updated' = 'inserted';

    for (const rawLine of lineItems) {
      const line = asObject(rawLine);
      if (!line) { skipped++; continue; }

      const zohoItemId = asString(line.item_id);
      const zohoLineItemId = asString(line.line_item_id, line.id);
      const qty = asPositiveInt(line.quantity, line.accepted_quantity, line.quantity_received);
      if (!zohoItemId || qty <= 0) { skipped++; continue; }

      let existingId: number | null = null;
      if (lineCols.has('zoho_purchase_receive_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId) {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM receiving_lines
           WHERE zoho_purchase_receive_id = $1 AND zoho_line_item_id = $2
           LIMIT 1`,
          [normalizedReceiveId, zohoLineItemId]
        );
        existingId = existing.rows[0]?.id ?? null;
      }

      const lineValues: Record<string, unknown> = {
        zoho_item_id: zohoItemId,
        zoho_line_item_id: zohoLineItemId,
        zoho_purchase_receive_id: normalizedReceiveId,
        item_name: asString(line.name, line.item_name),
        sku: asString(line.sku),
        quantity_received: qty,
        quantity_expected: asPositiveInt(line.quantity),
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
        condition_grade: 'BRAND_NEW',
        disposition_audit: JSON.stringify([]),
        notes: null,
      };

      if (existingId) {
        const updatable = ['zoho_item_id', 'item_name', 'sku', 'quantity_received', 'quantity_expected', 'notes'];
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
        if (cols.length === 0) { skipped++; continue; }

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
