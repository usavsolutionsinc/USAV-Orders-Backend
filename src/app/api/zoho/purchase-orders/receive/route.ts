import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createPurchaseReceive } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

/**
 * POST /api/zoho/purchase-orders/receive
 *
 * All-in-one "receive a PO" endpoint for the warehouse team:
 *  1. Creates a Purchase Receive record in Zoho Inventory
 *  2. Inserts a row in the local `receiving` table
 *  3. Inserts rows into `receiving_lines` for every submitted line item
 *  4. Optionally creates a `work_assignments` row (needs_test + assigned_tech_id)
 *
 * Body:
 * {
 *   purchaseorder_id:  string   (required)
 *   warehouse_id?:     string
 *   receive_date?:     string   (YYYY-MM-DD, defaults to today)
 *   received_by?:      number   (staff id)
 *   needs_test?:       boolean
 *   assigned_tech_id?: number
 *   condition_grade?:  string   (BRAND_NEW | USED_A | USED_B | USED_C | PARTS)
 *   target_channel?:   string   (ORDERS | FBA)
 *   notes?:            string
 *   line_items:        Array<{
 *     line_item_id:       string   (Zoho PO line id — used to create Zoho receive)
 *     item_id:            string   (Zoho item id — stored in receiving_lines)
 *     item_name?:         string
 *     sku?:               string
 *     quantity_received:  number
 *     condition_grade?:   string   (per-item override)
 *   }>
 * }
 */

const VALID_CONDITIONS = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();

    const purchaseOrderId = String(body?.purchaseorder_id || '').trim();
    if (!purchaseOrderId) {
      return NextResponse.json({ success: false, error: 'purchaseorder_id is required' }, { status: 400 });
    }

    const warehouseId = String(body?.warehouse_id || '').trim() || null;
    const receivedByRaw = Number(body?.received_by);
    const receivedBy = Number.isFinite(receivedByRaw) && receivedByRaw > 0 ? receivedByRaw : null;
    const assignedTechIdRaw = Number(body?.assigned_tech_id);
    const assignedTechId =
      Number.isFinite(assignedTechIdRaw) && assignedTechIdRaw > 0 ? assignedTechIdRaw : null;
    const needsTest = !!body?.needs_test;
    const defaultCondition = VALID_CONDITIONS.has(String(body?.condition_grade || '').toUpperCase())
      ? String(body.condition_grade).toUpperCase()
      : 'BRAND_NEW';
    const targetChannel = String(body?.target_channel || '')
      .trim()
      .toUpperCase();
    const notes = String(body?.notes || '').trim() || null;

    const rawLines: Record<string, unknown>[] = Array.isArray(body?.line_items) ? body.line_items : [];
    const lineItems = rawLines
      .map((l: Record<string, unknown>) => ({
        line_item_id:      String(l?.line_item_id || '').trim(),
        item_id:           String(l?.item_id || '').trim(),
        item_name:         String(l?.item_name || '').trim() || null,
        sku:               String(l?.sku || '').trim() || null,
        quantity_received: Math.floor(Math.max(0, Number(l?.quantity_received ?? 0))),
        quantity_expected: Number.isFinite(Number(l?.quantity)) && Number(l.quantity) > 0
          ? Math.floor(Number(l.quantity))
          : null,
        condition_grade: VALID_CONDITIONS.has(String(l?.condition_grade || '').toUpperCase())
          ? String(l.condition_grade).toUpperCase()
          : defaultCondition,
      }))
      .filter((l) => l.line_item_id && l.item_id && l.quantity_received > 0);

    if (lineItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one line item with quantity_received > 0 is required' },
        { status: 400 }
      );
    }

    // ── 1. Create purchase receive in Zoho ──────────────────────────────────
    const receiveDate =
      String(body?.receive_date || '').trim() || new Date().toISOString().substring(0, 10);

    const zohoReceive = await createPurchaseReceive({
      purchaseOrderId,
      warehouseId: warehouseId || undefined,
      date: receiveDate,
      lineItems: lineItems.map((l) => ({
        line_item_id: l.line_item_id,
        quantity_received: l.quantity_received,
      })),
    });

    const purchaseReceiveId = String(
      (zohoReceive as Record<string, unknown>)?.purchasereceive
        ? ((zohoReceive as Record<string, unknown>).purchasereceive as Record<string, unknown>)?.purchase_receive_id
        : (zohoReceive as Record<string, unknown>)?.purchase_receive_id ?? ''
    ).trim();

    // ── 2. Persist to local DB ──────────────────────────────────────────────
    const normalizedDate = `${receiveDate} 00:00:00`;

    await client.query('BEGIN');

    // Introspect receiving table columns
    const columnsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`
    );
    const receivingCols = new Set<string>(columnsRes.rows.map((r) => r.column_name));

    // Build receiving insert — condition_grade and disposition_code are now nullable
    // (they're per-item on receiving_lines for PO receives; receiving only tracks lifecycle)
    const valuesByColumn: Record<string, unknown> = {
      receiving_date_time: normalizedDate,
      receiving_tracking_number: purchaseReceiveId || purchaseOrderId,
      carrier: 'ZOHO_PO',
      received_at: normalizedDate,
      received_by: receivedBy,
      qa_status: 'PENDING',
      is_return: false,
      needs_test: needsTest,
      assigned_tech_id: assignedTechId,
      target_channel:
        targetChannel === 'FBA' ? 'FBA' : targetChannel === 'ORDERS' ? 'ORDERS' : null,
      zoho_purchase_receive_id: purchaseReceiveId || null,
      zoho_warehouse_id: warehouseId,
      notes,
      updated_at: new Date().toISOString(),
    };

    if (receivingCols.has('date_time')) {
      valuesByColumn['date_time'] = normalizedDate;
    }

    const insertCols: string[] = [];
    const insertVals: unknown[] = [];
    for (const [col, val] of Object.entries(valuesByColumn)) {
      if (!receivingCols.has(col)) continue;
      insertCols.push(col);
      insertVals.push(val);
    }

    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertedRow = await client.query<{ id: number }>(
      `INSERT INTO receiving (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      insertVals
    );
    const receivingId = Number(insertedRow.rows[0].id);

    // Insert receiving_lines — write all Zoho inventory fields directly (schema is guaranteed)
    let insertedLines = 0;
    for (const line of lineItems) {
      await client.query(
        `INSERT INTO receiving_lines (
          receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id,
          item_name, sku, quantity_received, quantity_expected,
          qa_status, disposition_code, condition_grade, disposition_audit
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING','HOLD',$9,'[]'::jsonb)`,
        [
          receivingId,
          line.item_id,
          line.line_item_id,
          purchaseReceiveId || null,
          line.item_name || null,
          line.sku || null,
          line.quantity_received,
          line.quantity_expected ?? null,
          line.condition_grade,
        ]
      );
      insertedLines++;
    }

    // Optionally create work assignment
    if (needsTest && assignedTechId) {
      const hasAssignRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables WHERE table_name = 'work_assignments'
         ) AS exists`
      );
      if (hasAssignRes.rows[0]?.exists) {
        await client.query(
          `INSERT INTO work_assignments
             (entity_type, entity_id, work_type, assignee_staff_id, status, priority, notes)
           VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)
           ON CONFLICT DO NOTHING`,
          [
            receivingId,
            assignedTechId,
            `Auto-created from Zoho PO ${purchaseOrderId}${purchaseReceiveId ? ` / receive ${purchaseReceiveId}` : ''}`,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      purchase_receive_id: purchaseReceiveId || null,
      purchaseorder_id: purchaseOrderId,
      line_items_received: insertedLines,
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = error instanceof Error ? error.message : 'Failed to receive PO';
    console.error('Zoho PO receive failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
