import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { adjustBinQty } from '@/lib/neon/location-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import {
  assertPermission,
  PermissionDeniedError,
  permissionDeniedResponse,
} from '@/lib/auth/permissions';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';

const ROUTE_CC_LINE = 'cycle-counts.line.patch';

/**
 * PATCH /api/cycle-counts/lines/[id]
 *
 * Two actions:
 *   { action: 'submit',  countedQty, staffId, notes?, clientEventId? }
 *     Records the physical count. If within variance_tol the row auto-
 *     approves and a CYCLE_COUNT_ADJ ledger row + bin_contents.qty fix is
 *     applied. Otherwise the row moves to `pending_review`.
 *
 *   { action: 'approve' | 'reject', staffId, clientEventId? }
 *     Admin-only. Approve writes the variance adjustment; reject leaves
 *     bin_contents untouched and stamps approved_by for audit.
 *
 * Idempotent on `Idempotency-Key` / `clientEventId`.
 */

interface LineRow {
  id: number;
  campaign_id: number;
  bin_id: number;
  sku: string;
  expected_qty: number;
  counted_qty: number | null;
  variance: number;
  status: string;
  variance_tol: number;
}

async function loadLine(id: number): Promise<LineRow | null> {
  const r = await pool.query<LineRow>(
    `SELECT ccl.id, ccl.campaign_id, ccl.bin_id, ccl.sku, ccl.expected_qty,
            ccl.counted_qty, ccl.variance, ccl.status,
            c.variance_tol::float AS variance_tol
     FROM cycle_count_lines ccl
     JOIN cycle_count_campaigns c ON c.id = ccl.campaign_id
     WHERE ccl.id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function applyVariance(line: LineRow, countedQty: number, staffId: number | null) {
  const delta = countedQty - line.expected_qty;
  if (delta === 0) return null;
  // Single source of truth: adjustBinQty also writes the ledger + sku_stock.
  await adjustBinQty({
    locationId: line.bin_id,
    sku: line.sku,
    delta,
    staffId,
    reason: 'CYCLE_COUNT_ADJ',
  });
  // Tie the variance to the lifecycle timeline.
  try {
    await recordInventoryEvent({
      event_type: 'ADJUSTED',
      actor_staff_id: staffId,
      station: 'MOBILE',
      bin_id: line.bin_id,
      sku: line.sku,
      notes: `Cycle count adjustment: expected ${line.expected_qty}, counted ${countedQty}, Δ ${delta}`,
      payload: {
        action: 'cycle_count_adjust',
        campaign_id: line.campaign_id,
        line_id: line.id,
        expected_qty: line.expected_qty,
        counted_qty: countedQty,
        delta,
      },
    });
  } catch {
    /* non-fatal */
  }
  return delta;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await params;
  const lineId = Number(idRaw);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ error: 'Valid line id required' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    const staffId =
      Number.isFinite(Number(body?.staffId)) && Number(body?.staffId) > 0
        ? Math.floor(Number(body?.staffId))
        : null;
    const countedQty = Number(body?.countedQty);
    const notes = String(body?.notes || '').trim() || null;

    // ─── Idempotency ────────────────────────────────────────────────────────
    const idempotencyKey = readIdempotencyKey(request, body?.clientEventId ?? null);
    if (idempotencyKey) {
      const cached = await getApiIdempotencyResponse(pool, idempotencyKey, ROUTE_CC_LINE);
      if (cached) {
        return NextResponse.json(cached.response_body, { status: cached.status_code });
      }
    }
    const respond = async (payload: Record<string, unknown>, status = 200) => {
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: ROUTE_CC_LINE,
          staffId,
          statusCode: status,
          responseBody: payload,
        }).catch(() => {});
      }
      return NextResponse.json(payload, { status });
    };

    const line = await loadLine(lineId);
    if (!line) return respond({ error: 'Line not found' }, 404);

    // ─── Submit count ──────────────────────────────────────────────────────
    if (action === 'submit') {
      try {
        await assertPermission(staffId, 'bin.set');
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          return respond(permissionDeniedResponse(err), 403);
        }
        throw err;
      }
      if (!Number.isFinite(countedQty) || countedQty < 0) {
        return respond({ error: 'countedQty must be a non-negative integer' }, 400);
      }
      const variance = countedQty - line.expected_qty;
      const tol = line.variance_tol;
      const denom = Math.max(line.expected_qty, 1);
      const withinTolerance = Math.abs(variance) / denom <= tol;

      if (withinTolerance) {
        // Auto-approve.
        await applyVariance(line, Math.floor(countedQty), staffId);
        const upd = await pool.query(
          `UPDATE cycle_count_lines
           SET counted_qty = $2, status = 'approved',
               counted_by = $3, counted_at = NOW(),
               approved_by = $3, approved_at = NOW(),
               notes = COALESCE($4, notes),
               updated_at = NOW()
           WHERE id = $1
           RETURNING id, status, counted_qty, variance`,
          [lineId, Math.floor(countedQty), staffId, notes],
        );
        return respond({
          success: true,
          line: upd.rows[0],
          auto_approved: true,
          variance,
        });
      }

      // Over tolerance — route to admin review.
      const upd = await pool.query(
        `UPDATE cycle_count_lines
         SET counted_qty = $2, status = 'pending_review',
             counted_by = $3, counted_at = NOW(),
             notes = COALESCE($4, notes),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, counted_qty, variance`,
        [lineId, Math.floor(countedQty), staffId, notes],
      );
      return respond({
        success: true,
        line: upd.rows[0],
        auto_approved: false,
        needs_review: true,
        variance,
        tolerance: tol,
      });
    }

    // ─── Approve / reject ──────────────────────────────────────────────────
    if (action === 'approve' || action === 'reject') {
      try {
        await assertPermission(staffId, 'cycle_count.approve');
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          return respond(permissionDeniedResponse(err), 403);
        }
        throw err;
      }
      if (line.status !== 'pending_review' && line.status !== 'counted') {
        return respond({ error: `Line is ${line.status}; cannot ${action}` }, 409);
      }
      if (action === 'approve') {
        if (line.counted_qty == null) {
          return respond({ error: 'Line has no countedQty; submit first' }, 409);
        }
        await applyVariance(line, line.counted_qty, staffId);
      }
      const upd = await pool.query(
        `UPDATE cycle_count_lines
         SET status = $2,
             approved_by = $3, approved_at = NOW(),
             notes = COALESCE($4, notes),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, counted_qty, variance`,
        [lineId, action === 'approve' ? 'approved' : 'rejected', staffId, notes],
      );
      return respond({ success: true, line: upd.rows[0] });
    }

    return respond({ error: 'Unsupported action' }, 400);
  } catch (err: any) {
    console.error('[PATCH /api/cycle-counts/lines/[id]] error:', err);
    return NextResponse.json(
      { error: 'Failed to update line', details: err?.message },
      { status: 500 },
    );
  }
}
