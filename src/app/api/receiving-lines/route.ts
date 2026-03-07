import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const QA_STATUSES   = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
const DISPOSITIONS  = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
const CONDITIONS    = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const receivingId = Number(searchParams.get('receiving_id'));
    const id = Number(searchParams.get('id'));

    if (Number.isFinite(id) && id > 0) {
      const one = await pool.query(`SELECT * FROM receiving_lines WHERE id = $1`, [id]);
      if (one.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, receiving_line: normalizeRow(one.rows[0]) });
    }

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid receiving_id is required' }, { status: 400 });
    }

    const rows = await pool.query(
      `SELECT * FROM receiving_lines WHERE receiving_id = $1 ORDER BY id ASC`,
      [receivingId]
    );

    return NextResponse.json({ success: true, receiving_lines: rows.rows.map(normalizeRow) });
  } catch (error: any) {
    console.error('Failed to fetch receiving lines:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch receiving lines' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const receivingId       = Number(body?.receiving_id);
    const zohoItemId        = String(body?.zoho_item_id || '').trim();
    const zohoLineItemId    = String(body?.zoho_line_item_id || '').trim() || null;
    const zohoPurchaseReceiveId = String(body?.zoho_purchase_receive_id || '').trim() || null;
    const itemName          = String(body?.item_name || '').trim() || null;
    const sku               = String(body?.sku || '').trim() || null;

    const qtyReceivedRaw    = Number(body?.quantity_received ?? body?.quantity);
    const quantityReceived  = Number.isFinite(qtyReceivedRaw) && qtyReceivedRaw > 0 ? Math.floor(qtyReceivedRaw) : 0;

    const qtyExpectedRaw    = Number(body?.quantity_expected);
    const quantityExpected  = Number.isFinite(qtyExpectedRaw) && qtyExpectedRaw > 0 ? Math.floor(qtyExpectedRaw) : null;

    const qaStatusRaw       = String(body?.qa_status || 'PENDING').trim().toUpperCase();
    const dispositionRaw    = String(body?.disposition_code || 'HOLD').trim().toUpperCase();
    const conditionRaw      = String(body?.condition_grade || 'BRAND_NEW').trim().toUpperCase();
    const dispositionAudit  = Array.isArray(body?.disposition_audit) ? body.disposition_audit : [];
    const notes             = String(body?.notes || '').trim() || null;

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid receiving_id is required' }, { status: 400 });
    }
    if (!zohoItemId) {
      return NextResponse.json({ success: false, error: 'zoho_item_id is required' }, { status: 400 });
    }
    if (quantityReceived <= 0) {
      return NextResponse.json({ success: false, error: 'quantity_received must be > 0' }, { status: 400 });
    }
    if (!QA_STATUSES.has(qaStatusRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
    }
    if (!DISPOSITIONS.has(dispositionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
    }
    if (!CONDITIONS.has(conditionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO receiving_lines (
        receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id,
        item_name, sku, quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, disposition_audit, notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
      RETURNING *`,
      [
        receivingId, zohoItemId, zohoLineItemId, zohoPurchaseReceiveId,
        itemName, sku, quantityReceived, quantityExpected,
        qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit), notes,
      ]
    );

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create receiving line:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create receiving line' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = Number(body?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[]  = [];
    let idx = 1;

    // Scalar text fields
    const textFields: Array<[string, string | null]> = [
      ['item_name',                String(body?.item_name ?? '').trim() || null],
      ['sku',                      String(body?.sku ?? '').trim() || null],
      ['zoho_line_item_id',        String(body?.zoho_line_item_id ?? '').trim() || null],
      ['zoho_purchase_receive_id', String(body?.zoho_purchase_receive_id ?? '').trim() || null],
      ['notes',                    String(body?.notes ?? '').trim() || null],
    ];
    for (const [col, val] of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, col)) {
        updates.push(`${col} = $${idx++}`);
        values.push(val);
      }
    }

    if (body?.quantity_received !== undefined || body?.quantity !== undefined) {
      const raw = Number(body?.quantity_received ?? body?.quantity);
      const qty = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
      if (qty <= 0) {
        return NextResponse.json({ success: false, error: 'quantity_received must be > 0' }, { status: 400 });
      }
      updates.push(`quantity_received = $${idx++}`);
      values.push(qty);
    }

    if (body?.quantity_expected !== undefined) {
      const raw = Number(body.quantity_expected);
      updates.push(`quantity_expected = $${idx++}`);
      values.push(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null);
    }

    if (body?.qa_status !== undefined) {
      const qa = String(body.qa_status || '').trim().toUpperCase();
      if (!QA_STATUSES.has(qa)) {
        return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
      }
      updates.push(`qa_status = $${idx++}`);
      values.push(qa);
    }
    if (body?.disposition_code !== undefined) {
      const d = String(body.disposition_code || '').trim().toUpperCase();
      if (!DISPOSITIONS.has(d)) {
        return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
      }
      updates.push(`disposition_code = $${idx++}`);
      values.push(d);
    }
    if (body?.condition_grade !== undefined) {
      const c = String(body.condition_grade || '').trim().toUpperCase();
      if (!CONDITIONS.has(c)) {
        return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
      }
      updates.push(`condition_grade = $${idx++}`);
      values.push(c);
    }
    if (body?.disposition_audit !== undefined) {
      updates.push(`disposition_audit = $${idx++}::jsonb`);
      values.push(JSON.stringify(Array.isArray(body.disposition_audit) ? body.disposition_audit : []));
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE receiving_lines SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) });
  } catch (error: any) {
    console.error('Failed to update receiving line:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update receiving line' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const result = await pool.query(`DELETE FROM receiving_lines WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('Failed to delete receiving line:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete receiving line' },
      { status: 500 }
    );
  }
}

function normalizeRow(row: any) {
  return {
    id:                       Number(row.id),
    receiving_id:             Number(row.receiving_id),
    zoho_item_id:             row.zoho_item_id,
    zoho_line_item_id:        row.zoho_line_item_id ?? null,
    zoho_purchase_receive_id: row.zoho_purchase_receive_id ?? null,
    item_name:                row.item_name ?? null,
    sku:                      row.sku ?? null,
    quantity_received:        Number(row.quantity_received),
    quantity_expected:        row.quantity_expected != null ? Number(row.quantity_expected) : null,
    qa_status:                row.qa_status,
    disposition_code:         row.disposition_code,
    condition_grade:          row.condition_grade,
    disposition_audit:        row.disposition_audit ?? [],
    notes:                    row.notes ?? null,
    created_at:               row.created_at ?? null,
  };
}
