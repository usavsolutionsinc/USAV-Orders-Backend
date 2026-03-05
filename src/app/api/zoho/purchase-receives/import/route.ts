import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getPurchaseReceiveById } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

type ZohoLineItem = {
  item_id?: string;
  quantity?: number | string;
  accepted_quantity?: number | string;
};

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const purchaseReceiveId = String(body?.purchase_receive_id || '').trim();
    const receivedByRaw = Number(body?.received_by);
    const receivedBy = Number.isFinite(receivedByRaw) && receivedByRaw > 0 ? receivedByRaw : null;
    const assignedTechIdRaw = Number(body?.assigned_tech_id);
    const assignedTechId = Number.isFinite(assignedTechIdRaw) && assignedTechIdRaw > 0 ? assignedTechIdRaw : null;
    const needsTest = !!body?.needs_test;
    const targetChannel = String(body?.target_channel || '').trim().toUpperCase();

    if (!purchaseReceiveId) {
      return NextResponse.json({ success: false, error: 'purchase_receive_id is required' }, { status: 400 });
    }

    const detail = await getPurchaseReceiveById(purchaseReceiveId);
    const receive = (detail as any)?.purchasereceive;
    if (!receive) {
      return NextResponse.json({ success: false, error: 'Zoho purchase receive not found' }, { status: 404 });
    }

    const receiveDate = String(receive.date || '').trim();
    const normalizedDate = receiveDate ? `${receiveDate} 00:00:00` : new Date().toISOString();
    const warehouseId = String(receive.warehouse_id || '').trim() || null;
    const tracking = String(receive.reference_number || receive.purchase_receive_number || purchaseReceiveId).trim();

    await client.query('BEGIN');
    const columnsRes = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'receiving'`
    );
    const availableColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));
    const valuesByColumn: Record<string, any> = {
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
      zoho_purchase_receive_id: purchaseReceiveId,
      zoho_warehouse_id: warehouseId,
      updated_at: new Date().toISOString(),
    };

    const insertColumns: string[] = [];
    const insertValues: any[] = [];
    Object.entries(valuesByColumn).forEach(([column, value]) => {
      if (!availableColumns.has(column)) return;
      insertColumns.push(column);
      insertValues.push(value);
    });

    if (availableColumns.has('date_time')) {
      insertColumns.push('date_time');
      insertValues.push(normalizedDate);
    }

    const valuePlaceholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
    const insertedReceiving = await client.query(
      `INSERT INTO receiving (${insertColumns.join(', ')})
       VALUES (${valuePlaceholders})
       RETURNING id`,
      insertValues
    );
    const receivingId = Number(insertedReceiving.rows[0].id);

    const lineItems: ZohoLineItem[] = Array.isArray(receive.line_items) ? receive.line_items : [];
    const hasReceivingLinesRes = await client.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'receiving_lines'
      ) AS exists`
    );
    const hasReceivingLines = !!hasReceivingLinesRes.rows[0]?.exists;

    let insertedLines = 0;
    if (hasReceivingLines && lineItems.length > 0) {
      for (const line of lineItems) {
        const zohoItemId = String(line.item_id || '').trim();
        if (!zohoItemId) continue;
        const quantityRaw = Number(line.accepted_quantity ?? line.quantity ?? 0);
        const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 0;
        if (quantity <= 0) continue;

        await client.query(
          `INSERT INTO receiving_lines (
            receiving_id, zoho_item_id, quantity, qa_status, disposition_code, condition_grade, disposition_audit
          )
          VALUES ($1, $2, $3, 'PENDING', 'HOLD', 'BRAND_NEW', '[]'::jsonb)`,
          [receivingId, zohoItemId, quantity]
        );
        insertedLines += 1;
      }
    }

    if (needsTest && assignedTechId) {
      const hasAssignmentsRes = await client.query(
        `SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_name = 'work_assignments'
        ) AS exists`
      );
      if (hasAssignmentsRes.rows[0]?.exists) {
        await client.query(
          `INSERT INTO work_assignments (
             entity_type,
             entity_id,
             work_type,
             assignee_staff_id,
             status,
             priority,
             notes
           )
           VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)
           ON CONFLICT DO NOTHING`,
          [receivingId, assignedTechId, `Auto-created from Zoho purchase receive ${purchaseReceiveId}`]
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      purchase_receive_id: purchaseReceiveId,
      line_items_imported: insertedLines,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Zoho purchase receive import failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to import Zoho purchase receive',
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
