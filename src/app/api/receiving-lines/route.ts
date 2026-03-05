import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const QA_STATUSES = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
const DISPOSITIONS = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
const CONDITIONS = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

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
      return NextResponse.json({ success: true, receiving_line: one.rows[0] });
    }

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid receiving_id is required' }, { status: 400 });
    }

    const rows = await pool.query(
      `SELECT *
       FROM receiving_lines
       WHERE receiving_id = $1
       ORDER BY id ASC`,
      [receivingId]
    );

    return NextResponse.json({ success: true, receiving_lines: rows.rows });
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
    const receivingId = Number(body?.receiving_id);
    const zohoItemId = String(body?.zoho_item_id || '').trim();
    const quantityRaw = Number(body?.quantity);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 0;
    const qaStatusRaw = String(body?.qa_status || 'PENDING').trim().toUpperCase();
    const dispositionRaw = String(body?.disposition_code || 'HOLD').trim().toUpperCase();
    const conditionRaw = String(body?.condition_grade || 'BRAND_NEW').trim().toUpperCase();
    const dispositionAudit = Array.isArray(body?.disposition_audit) ? body.disposition_audit : [];

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid receiving_id is required' }, { status: 400 });
    }
    if (!zohoItemId) {
      return NextResponse.json({ success: false, error: 'zoho_item_id is required' }, { status: 400 });
    }
    if (quantity <= 0) {
      return NextResponse.json({ success: false, error: 'quantity must be > 0' }, { status: 400 });
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
        receiving_id, zoho_item_id, quantity, qa_status, disposition_code, condition_grade, disposition_audit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *`,
      [receivingId, zohoItemId, quantity, qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit)]
    );

    return NextResponse.json({ success: true, receiving_line: result.rows[0] }, { status: 201 });
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
    const values: any[] = [];
    let idx = 1;

    if (body?.quantity !== undefined) {
      const quantityRaw = Number(body.quantity);
      const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 0;
      if (quantity <= 0) {
        return NextResponse.json({ success: false, error: 'quantity must be > 0' }, { status: 400 });
      }
      updates.push(`quantity = $${idx++}`);
      values.push(quantity);
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
      const disposition = String(body.disposition_code || '').trim().toUpperCase();
      if (!DISPOSITIONS.has(disposition)) {
        return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
      }
      updates.push(`disposition_code = $${idx++}`);
      values.push(disposition);
    }
    if (body?.condition_grade !== undefined) {
      const condition = String(body.condition_grade || '').trim().toUpperCase();
      if (!CONDITIONS.has(condition)) {
        return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
      }
      updates.push(`condition_grade = $${idx++}`);
      values.push(condition);
    }
    if (body?.disposition_audit !== undefined) {
      const audit = Array.isArray(body.disposition_audit) ? body.disposition_audit : [];
      updates.push(`disposition_audit = $${idx++}::jsonb`);
      values.push(JSON.stringify(audit));
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE receiving_lines
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, receiving_line: result.rows[0] });
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
