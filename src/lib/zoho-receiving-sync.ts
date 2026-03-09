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

function asNonNegativeInt(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

// ─── Import by Purchase Receive ───────────────────────────────────────────────

type ImportOptions = {
  purchaseReceiveId: string;
  receivedBy?: number | null;
  assignedTechId?: number | null;
  needsTest?: boolean;
  targetChannel?: string | null;
};

export type ImportResult = {
  receiving_id: number;
  purchase_receive_id: string;
  line_items_imported: number;
  mode: 'created' | 'updated';
};

export async function importZohoPurchaseReceiveToReceiving(
  options: ImportOptions
): Promise<ImportResult> {
  const purchaseReceiveIdInput = asString(options.purchaseReceiveId);
  if (!purchaseReceiveIdInput) {
    throw new Error('purchase_receive_id is required');
  }

  const detail = await getPurchaseReceiveById(purchaseReceiveIdInput);
  const receive = asObject((detail as AnyRow)?.purchasereceive);
  if (!receive) {
    throw new Error('Zoho purchase receive not found');
  }

  const normalizedReceiveId =
    asString(receive.purchase_receive_id, receive.receive_id, receive.id, purchaseReceiveIdInput) ||
    purchaseReceiveIdInput;

  const receiveDate = asString(receive.date);
  const normalizedDate = receiveDate ? `${receiveDate} 00:00:00` : new Date().toISOString();
  const warehouseId = asString(receive.warehouse_id);
  const tracking =
    asString(
      receive.reference_number,
      receive.purchase_receive_number,
      receive.receive_number,
      normalizedReceiveId
    ) || normalizedReceiveId;

  const targetChannel = String(options.targetChannel || '')
    .trim()
    .toUpperCase();
  const needsTest = !!options.needsTest;
  const receivedBy =
    Number.isFinite(Number(options.receivedBy)) && Number(options.receivedBy) > 0
      ? Math.floor(Number(options.receivedBy))
      : null;
  const assignedTechId =
    Number.isFinite(Number(options.assignedTechId)) && Number(options.assignedTechId) > 0
      ? Math.floor(Number(options.assignedTechId))
      : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const receivingColsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`
    );
    const receivingCols = new Set(receivingColsRes.rows.map((r) => r.column_name));

    const valuesByColumn: Record<string, unknown> = {
      receiving_date_time: normalizedDate,
      receiving_tracking_number: tracking,
      carrier: 'ZOHO',
      received_at: normalizedDate,
      received_by: receivedBy,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      is_return: false,
      needs_test: needsTest,
      assigned_tech_id: assignedTechId,
      target_channel: targetChannel === 'FBA' ? 'FBA' : targetChannel === 'ORDERS' ? 'ORDERS' : null,
      zoho_purchase_receive_id: normalizedReceiveId,
      zoho_warehouse_id: warehouseId,
      updated_at: new Date().toISOString(),
    };
    if (receivingCols.has('date_time')) valuesByColumn.date_time = normalizedDate;

    let receivingId: number | null = null;
    let mode: 'created' | 'updated' = 'created';
    if (receivingCols.has('zoho_purchase_receive_id')) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM receiving WHERE zoho_purchase_receive_id = $1 ORDER BY id DESC LIMIT 1`,
        [normalizedReceiveId]
      );
      if (existing.rows[0]?.id) {
        receivingId = Number(existing.rows[0].id);
        mode = 'updated';
      }
    }

    if (receivingId) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [column, value] of Object.entries(valuesByColumn)) {
        if (!receivingCols.has(column)) continue;
        updates.push(`${column} = $${i++}`);
        values.push(value);
      }
      values.push(receivingId);
      if (updates.length > 0) {
        await client.query(`UPDATE receiving SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
      }
    } else {
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const [column, value] of Object.entries(valuesByColumn)) {
        if (!receivingCols.has(column)) continue;
        cols.push(column);
        vals.push(value);
      }
      if (cols.length === 0) throw new Error('No valid columns to insert into receiving table');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO receiving (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      receivingId = Number(inserted.rows[0].id);
    }

    const receivingLinesExistsRes = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving_lines') AS exists`
    );
    const hasReceivingLines = !!receivingLinesExistsRes.rows[0]?.exists;

    let insertedLines = 0;
    if (hasReceivingLines && receivingId) {
      const lineColsRes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
      );
      const lineCols = new Set(lineColsRes.rows.map((r) => r.column_name));

      await client.query(`DELETE FROM receiving_lines WHERE receiving_id = $1`, [receivingId]);

      const lineItems = Array.isArray(receive.line_items) ? receive.line_items : [];
      for (const rawLine of lineItems) {
        const line = asObject(rawLine);
        if (!line) continue;

        const zohoItemId = asString(line.item_id);
        const zohoLineItemId = asString(line.line_item_id, line.id);
        // Zoho purchase receive line items use "quantity" per API docs
        const qty = asPositiveInt(line.quantity, line.accepted_quantity, line.quantity_received);
        if (!zohoItemId || qty <= 0) continue;

        const lineValues: Record<string, unknown> = {
          receiving_id: receivingId,
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

        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [column, value] of Object.entries(lineValues)) {
          if (!lineCols.has(column)) continue;
          cols.push(column);
          vals.push(column === 'disposition_audit' ? `${value}` : value);
        }

        if (!lineCols.has('quantity_received')) continue;
        if (cols.length === 0) continue;

        const placeholders = cols.map((c, i) => (c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`));
        await client.query(
          `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals
        );
        insertedLines++;
      }
    }

    if (needsTest && assignedTechId && receivingId) {
      const hasAssignmentsRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_assignments') AS exists`
      );
      if (hasAssignmentsRes.rows[0]?.exists) {
        await client.query(
          `INSERT INTO work_assignments
             (entity_type, entity_id, work_type, assignee_staff_id, status, priority, notes)
           VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)
           ON CONFLICT DO NOTHING`,
          [receivingId, assignedTechId, `Auto-created from Zoho purchase receive ${normalizedReceiveId}`]
        );
      }
    }

    await client.query('COMMIT');
    return {
      receiving_id: receivingId!,
      purchase_receive_id: normalizedReceiveId,
      line_items_imported: insertedLines,
      mode,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── Import by Purchase Order ─────────────────────────────────────────────────

export type ImportPOResult = {
  receiving_id: number;
  purchaseorder_id: string;
  purchaseorder_number: string;
  line_items_imported: number;
  mode: 'created' | 'updated';
};

/**
 * Imports a single Zoho Purchase Order into the receiving + receiving_lines tables.
 * Each PO creates/updates one receiving record (keyed on zoho_purchaseorder_id).
 * Each PO line item creates/updates one receiving_lines record (keyed on zoho_purchaseorder_id + zoho_line_item_id).
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
  const poDate = asString(po.date);
  const normalizedDate = poDate ? `${poDate} 00:00:00` : new Date().toISOString();
  const warehouseId = asString(po.warehouse_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Introspect receiving columns ──
    const receivingColsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`
    );
    const receivingCols = new Set(receivingColsRes.rows.map((r) => r.column_name));

    // ── Upsert receiving row ──
    const recValues: Record<string, unknown> = {
      receiving_tracking_number: poNumber,
      carrier: 'ZOHO-PO',
      received_at: normalizedDate,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      is_return: false,
      needs_test: false,
      zoho_purchaseorder_id: normalizedPoId,
      zoho_purchaseorder_number: poNumber,
      zoho_warehouse_id: warehouseId,
      updated_at: new Date().toISOString(),
    };
    if (receivingCols.has('date_time')) recValues.date_time = normalizedDate;
    if (receivingCols.has('receiving_date_time')) recValues.receiving_date_time = normalizedDate;

    let receivingId: number | null = null;
    let mode: 'created' | 'updated' = 'created';

    if (receivingCols.has('zoho_purchaseorder_id')) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM receiving WHERE zoho_purchaseorder_id = $1 ORDER BY id DESC LIMIT 1`,
        [normalizedPoId]
      );
      if (existing.rows[0]?.id) {
        receivingId = Number(existing.rows[0].id);
        mode = 'updated';
      }
    }

    if (receivingId) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [col, val] of Object.entries(recValues)) {
        if (!receivingCols.has(col)) continue;
        updates.push(`${col} = $${i++}`);
        values.push(val);
      }
      values.push(receivingId);
      if (updates.length > 0) {
        await client.query(`UPDATE receiving SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
      }
    } else {
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const [col, val] of Object.entries(recValues)) {
        if (!receivingCols.has(col)) continue;
        cols.push(col);
        vals.push(val);
      }
      if (cols.length === 0) throw new Error('No valid columns to insert into receiving table');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO receiving (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      receivingId = Number(inserted.rows[0].id);
    }

    // ── Upsert receiving_lines ──
    const receivingLinesExistsRes = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receiving_lines') AS exists`
    );
    const hasReceivingLines = !!receivingLinesExistsRes.rows[0]?.exists;

    let insertedLines = 0;
    if (hasReceivingLines && receivingId) {
      const lineColsRes = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
      );
      const lineCols = new Set(lineColsRes.rows.map((r) => r.column_name));

      // Delete existing lines for this PO's receiving record and re-insert
      if (lineCols.has('zoho_purchaseorder_id')) {
        await client.query(
          `DELETE FROM receiving_lines WHERE receiving_id = $1 AND zoho_purchaseorder_id = $2`,
          [receivingId, normalizedPoId]
        );
      } else {
        await client.query(`DELETE FROM receiving_lines WHERE receiving_id = $1`, [receivingId]);
      }

      const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
      for (const rawLine of lineItems) {
        const line = asObject(rawLine);
        if (!line) continue;

        const zohoItemId = asString(line.item_id);
        const zohoLineItemId = asString(line.line_item_id, line.id);
        // PO line items: quantity = ordered qty, quantity_received = already received qty
        const quantityExpected = asPositiveInt(line.quantity);
        const quantityReceived = asNonNegativeInt(line.quantity_received);
        if (!zohoItemId || quantityExpected <= 0) continue;

        const lineValues: Record<string, unknown> = {
          receiving_id: receivingId,
          zoho_item_id: zohoItemId,
          zoho_line_item_id: zohoLineItemId,
          zoho_purchaseorder_id: normalizedPoId,
          item_name: asString(line.name, line.item_name),
          sku: asString(line.sku),
          quantity_received: quantityReceived,
          quantity_expected: quantityExpected,
          qa_status: 'PENDING',
          disposition_code: 'HOLD',
          condition_grade: 'BRAND_NEW',
          disposition_audit: JSON.stringify([]),
          notes: asString(line.description),
        };

        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [column, value] of Object.entries(lineValues)) {
          if (!lineCols.has(column)) continue;
          cols.push(column);
          vals.push(column === 'disposition_audit' ? `${value}` : value);
        }

        // Need at least receiving_id + zoho_item_id + quantity_expected
        if (cols.length === 0) continue;
        if (!cols.includes('receiving_id')) continue;

        const placeholders = cols.map((c, i) => (c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`));
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
      purchaseorder_id: normalizedPoId,
      purchaseorder_number: poNumber,
      line_items_imported: insertedLines,
      mode,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
