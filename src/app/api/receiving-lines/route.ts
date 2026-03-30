import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

const QA_STATUSES  = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
const DISPOSITIONS = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
const CONDITIONS   = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

function parsePositiveTechId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// ?id=<n>              → single row
// ?receiving_id=<n>    → all lines for a package
// ?limit&offset&search → paginated list (omit receiving_id to get all)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id          = Number(searchParams.get('id'));
    const receivingId = Number(searchParams.get('receiving_id'));
    const limit       = Math.min(Number(searchParams.get('limit') || 200), 500);
    const offset      = Math.max(Number(searchParams.get('offset') || 0), 0);
    const search      = String(searchParams.get('search') || '').trim();
    const qaFilter    = String(searchParams.get('qa_status') || '').trim().toUpperCase();
    const dispFilter  = String(searchParams.get('disposition') || '').trim().toUpperCase();

    // Single row
    if (Number.isFinite(id) && id > 0) {
      const one = await pool.query(
        `SELECT rl.*, r.receiving_tracking_number, r.carrier
         FROM receiving_lines rl
         LEFT JOIN receiving r ON r.id = rl.receiving_id
         WHERE rl.id = $1`,
        [id],
      );
      if (one.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, receiving_line: normalizeRow(one.rows[0]) });
    }

    // All lines for a specific package
    if (Number.isFinite(receivingId) && receivingId > 0) {
      const rows = await pool.query(
        `SELECT rl.*, r.receiving_tracking_number, r.carrier
         FROM receiving_lines rl
         LEFT JOIN receiving r ON r.id = rl.receiving_id
         WHERE rl.receiving_id = $1
         ORDER BY rl.id ASC`,
        [receivingId],
      );
      return NextResponse.json({ success: true, receiving_lines: rows.rows.map(normalizeRow) });
    }

    // Paginated list — all lines, optionally filtered
    const conditions: string[] = [];
    const values: unknown[]    = [];
    let idx = 1;

    if (search) {
      conditions.push(
        `(rl.item_name ILIKE $${idx} OR rl.sku ILIKE $${idx} OR rl.zoho_purchaseorder_id ILIKE $${idx} OR rl.zoho_item_id ILIKE $${idx})`,
      );
      values.push(`%${search}%`);
      idx++;
    }
    if (qaFilter && QA_STATUSES.has(qaFilter)) {
      conditions.push(`rl.qa_status = $${idx++}`);
      values.push(qaFilter);
    }
    if (dispFilter && DISPOSITIONS.has(dispFilter)) {
      conditions.push(`rl.disposition_code = $${idx++}`);
      values.push(dispFilter);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit, offset);

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT rl.*, r.receiving_tracking_number, r.carrier
         FROM receiving_lines rl
         LEFT JOIN receiving r ON r.id = rl.receiving_id
         ${where}
         ORDER BY rl.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        values,
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM receiving_lines rl ${where}`,
        values.slice(0, -2),
      ),
    ]);

    return NextResponse.json({
      success: true,
      receiving_lines: rowsRes.rows.map(normalizeRow),
      total: Number(countRes.rows[0]?.total ?? 0),
      limit,
      offset,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch receiving lines';
    console.error('receiving-lines GET failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const receivingIdRaw = body?.receiving_id;
    const receivingId    = receivingIdRaw != null ? Number(receivingIdRaw) : null;
    const zohoItemId     = String(body?.zoho_item_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim() || null;
    const zohoPurchaseReceiveId = String(body?.zoho_purchase_receive_id || '').trim() || null;
    const zohoPurchaseOrderId   = String(body?.zoho_purchaseorder_id || '').trim() || null;
    const itemName       = String(body?.item_name || '').trim() || null;
    const sku            = String(body?.sku || '').trim() || null;
    const notes          = String(body?.notes || '').trim() || null;

    const qtyReceivedRaw   = Number(body?.quantity_received ?? body?.quantity ?? 0);
    const quantityReceived = Number.isFinite(qtyReceivedRaw) && qtyReceivedRaw >= 0 ? Math.floor(qtyReceivedRaw) : 0;

    const qtyExpectedRaw  = Number(body?.quantity_expected);
    const quantityExpected = Number.isFinite(qtyExpectedRaw) && qtyExpectedRaw > 0 ? Math.floor(qtyExpectedRaw) : null;

    const qaStatusRaw  = String(body?.qa_status || 'PENDING').trim().toUpperCase();
    const dispositionRaw = String(body?.disposition_code || 'HOLD').trim().toUpperCase();
    const conditionRaw   = String(body?.condition_grade || 'BRAND_NEW').trim().toUpperCase();
    const dispositionAudit = Array.isArray(body?.disposition_audit) ? body.disposition_audit : [];
    const assignedTechId = parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId);
    const needsTest = body?.needs_test === undefined && body?.needsTest === undefined
      ? true
      : !!(body?.needs_test ?? body?.needsTest);

    if (!zohoItemId) {
      return NextResponse.json({ success: false, error: 'zoho_item_id is required' }, { status: 400 });
    }
    if (receivingId !== null && (!Number.isFinite(receivingId) || receivingId <= 0)) {
      return NextResponse.json({ success: false, error: 'receiving_id must be a positive integer or null' }, { status: 400 });
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
        zoho_purchaseorder_id, item_name, sku,
        quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, disposition_audit, notes,
        needs_test, assigned_tech_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
      RETURNING *`,
      [
        receivingId, zohoItemId, zohoLineItemId, zohoPurchaseReceiveId,
        zohoPurchaseOrderId, itemName, sku,
        quantityReceived, quantityExpected,
        qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit), notes,
        needsTest, assignedTechId,
      ],
    );

    const lineId = result.rows[0]?.id;
    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'insert', rowId: String(lineId), source: 'receiving-lines.create' });

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create receiving line';
    console.error('receiving-lines POST failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id   = Number(body?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const textFields: Array<[string, string | null]> = [
      ['item_name',                String(body?.item_name ?? '').trim() || null],
      ['sku',                      String(body?.sku ?? '').trim() || null],
      ['zoho_item_id',             String(body?.zoho_item_id ?? '').trim() || null],
      ['zoho_line_item_id',        String(body?.zoho_line_item_id ?? '').trim() || null],
      ['zoho_purchase_receive_id', String(body?.zoho_purchase_receive_id ?? '').trim() || null],
      ['zoho_purchaseorder_id',    String(body?.zoho_purchaseorder_id ?? '').trim() || null],
      ['notes',                    String(body?.notes ?? '').trim() || null],
    ];
    for (const [col, val] of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, col.replace('zoho_item_id', 'zoho_item_id'))) {
        if (body[col] !== undefined) {
          updates.push(`${col} = $${idx++}`);
          values.push(val);
        }
      }
    }

    if (body?.receiving_id !== undefined) {
      const raw = body.receiving_id != null ? Number(body.receiving_id) : null;
      updates.push(`receiving_id = $${idx++}`);
      values.push(raw != null && Number.isFinite(raw) && raw > 0 ? raw : null);
    }

    if (body?.quantity_received !== undefined || body?.quantity !== undefined) {
      const raw = Number(body?.quantity_received ?? body?.quantity ?? 0);
      updates.push(`quantity_received = $${idx++}`);
      values.push(Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0);
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

    if (body?.assigned_tech_id !== undefined || body?.assignedTechId !== undefined) {
      updates.push(`assigned_tech_id = $${idx++}`);
      values.push(parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId));
    }

    if (body?.needs_test !== undefined || body?.needsTest !== undefined) {
      const nextNeedsTest = !!(body?.needs_test ?? body?.needsTest);
      if (!nextNeedsTest) {
        const existing = await pool.query<{ assigned_tech_id: number | null }>(
          `SELECT assigned_tech_id FROM receiving_lines WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        const effectiveTechId =
          parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId) ??
          parsePositiveTechId(existing.rows[0]?.assigned_tech_id);
        if (!effectiveTechId) {
          return NextResponse.json(
            { success: false, error: 'needs_test can only be cleared after a technician is assigned' },
            { status: 400 },
          );
        }
      }
      updates.push(`needs_test = $${idx++}`);
      values.push(nextNeedsTest);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE receiving_lines SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'update', rowId: String(id), source: 'receiving-lines.update' });

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update receiving line';
    console.error('receiving-lines PATCH failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
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

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'delete', rowId: String(id), source: 'receiving-lines.delete' });

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete receiving line';
    console.error('receiving-lines DELETE failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── Normalize ────────────────────────────────────────────────────────────────
function normalizeRow(row: Record<string, unknown>) {
  return {
    id:                       Number(row.id),
    receiving_id:             row.receiving_id != null ? Number(row.receiving_id) : null,
    // Joined from receiving table when available
    tracking_number:          (row.receiving_tracking_number as string | null) ?? null,
    carrier:                  (row.carrier as string | null) ?? null,
    zoho_item_id:             (row.zoho_item_id as string | null) ?? null,
    zoho_line_item_id:        (row.zoho_line_item_id as string | null) ?? null,
    zoho_purchase_receive_id: (row.zoho_purchase_receive_id as string | null) ?? null,
    zoho_purchaseorder_id:    (row.zoho_purchaseorder_id as string | null) ?? null,
    item_name:                (row.item_name as string | null) ?? null,
    sku:                      (row.sku as string | null) ?? null,
    quantity_received:        Number(row.quantity_received ?? 0),
    quantity_expected:        row.quantity_expected != null ? Number(row.quantity_expected) : null,
    qa_status:                (row.qa_status as string) ?? 'PENDING',
    workflow_status:          (row.workflow_status as string | null) ?? null,
    disposition_code:         (row.disposition_code as string) ?? 'HOLD',
    condition_grade:          (row.condition_grade as string) ?? 'BRAND_NEW',
    disposition_audit:        (row.disposition_audit as unknown[]) ?? [],
    needs_test:               !!row.needs_test,
    assigned_tech_id:         row.assigned_tech_id != null ? Number(row.assigned_tech_id) : null,
    zoho_sync_source:         (row.zoho_sync_source as string | null) ?? null,
    zoho_last_modified_time:  (row.zoho_last_modified_time as string | null) ?? null,
    zoho_synced_at:           (row.zoho_synced_at as string | null) ?? null,
    notes:                    (row.notes as string | null) ?? null,
    created_at:               (row.created_at as string | null) ?? null,
  };
}
