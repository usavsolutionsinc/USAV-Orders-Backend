import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

const ALLOWED_STATUSES = new Set(['open', 'resolved', 'discarded']);

/**
 * GET /api/tracking-exceptions/[id] — fetch a single row.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await context.params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT te.*, s.name AS staff_display_name,
              r.source AS receiving_source,
              r.zoho_purchaseorder_id AS receiving_zoho_po_id,
              r.carrier AS receiving_carrier
         FROM tracking_exceptions te
         LEFT JOIN staff s ON s.id = te.staff_id
         LEFT JOIN receiving r ON r.id = te.receiving_id
        WHERE te.id = $1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, exception: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load tracking_exception';
    console.error('GET /api/tracking-exceptions/[id] failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/tracking-exceptions/[id] — edit mutable fields from the triage
 * UI's pencil/edit dialog. Only the fields supplied in the body are updated.
 *
 * Body shape (all optional):
 *   { tracking_number, notes, exception_reason, status, staff_name,
 *     domain_metadata }
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await context.params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    const push = (sqlFragment: string, value: unknown) => {
      params.push(value);
      sets.push(sqlFragment.replace('$?', `$${params.length}`));
    };

    if (typeof body.tracking_number === 'string') {
      const trimmed = body.tracking_number.trim();
      if (!trimmed) {
        return NextResponse.json({ success: false, error: 'tracking_number cannot be empty' }, { status: 400 });
      }
      push('tracking_number = $?', trimmed);
    }

    if (body.notes === null || typeof body.notes === 'string') {
      push('notes = $?', body.notes);
    }

    if (typeof body.exception_reason === 'string') {
      push('exception_reason = $?', body.exception_reason);
    }

    if (body.staff_name === null || typeof body.staff_name === 'string') {
      push('staff_name = $?', body.staff_name);
    }

    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json({ success: false, error: 'invalid status' }, { status: 400 });
      }
      push('status = $?', body.status);
      if (body.status === 'resolved' || body.status === 'discarded') {
        sets.push(`resolved_at = COALESCE(resolved_at, NOW())`);
      } else {
        sets.push(`resolved_at = NULL`);
      }
    }

    if (body.domain_metadata && typeof body.domain_metadata === 'object') {
      params.push(JSON.stringify(body.domain_metadata));
      sets.push(`domain_metadata = COALESCE(domain_metadata, '{}'::jsonb) || $${params.length}::jsonb`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'no editable fields provided' }, { status: 400 });
    }

    sets.push('updated_at = NOW()');
    params.push(id);

    const sql = `UPDATE tracking_exceptions
                    SET ${sets.join(', ')}
                  WHERE id = $${params.length}
                  RETURNING *`;
    const result = await pool.query(sql, params);
    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }

    await invalidateCacheTags(['tracking-exceptions']);

    return NextResponse.json({ success: true, exception: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update tracking_exception';
    console.error('PATCH /api/tracking-exceptions/[id] failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/tracking-exceptions/[id] — hard delete. Only reachable from the
 * triage UI's edit dialog (intentional friction vs a one-click row action).
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idParam } = await context.params;
    const id = Number.parseInt(idParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
    }

    const result = await pool.query(
      `DELETE FROM tracking_exceptions WHERE id = $1`,
      [id],
    );

    await invalidateCacheTags(['tracking-exceptions']);

    return NextResponse.json({
      success: true,
      deleted: result.rowCount || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete tracking_exception';
    console.error('DELETE /api/tracking-exceptions/[id] failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
