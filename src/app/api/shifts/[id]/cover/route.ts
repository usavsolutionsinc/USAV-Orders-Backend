/**
 * POST /api/shifts/:id/cover
 *
 * Admin-only cover transaction:
 *   1. Cancel the original shift (status='cancelled').
 *   2. Insert a new shift for the covering staff, with covers_shift_id
 *      pointing back at the original for audit.
 *   3. Revoke any open sessions belonging to the original (covered) staff
 *      so they're forced to sign out — leaving the workstation free for
 *      the covering staff to sign in.
 *
 * Body: { coveringStaffId: number, startsAt?: ISO, endsAt?: ISO, notes?: string }
 * `startsAt` / `endsAt` default to the original shift's window.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { audit } from '@/lib/auth/audit';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

export const runtime = 'nodejs';

interface CoverBody {
  coveringStaffId?: number;
  startsAt?: string;
  endsAt?: string;
  notes?: string;
}

interface ShiftRow {
  id: number;
  staff_id: number;
  starts_at: Date;
  ends_at: Date;
  status: string;
  location_id: number | null;
}

export async function POST(req: NextRequest, routeCtx: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'admin.manage_staff');
  if (gate.denied) return gate.denied;
  const me = gate.ctx;

  const { id } = await routeCtx.params;
  const originalShiftId = Number(id);
  if (!Number.isFinite(originalShiftId) || originalShiftId <= 0) {
    return NextResponse.json({ error: 'INVALID_SHIFT_ID' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as CoverBody;
  const coveringStaffId = Number(body.coveringStaffId);
  if (!Number.isFinite(coveringStaffId) || coveringStaffId <= 0) {
    return NextResponse.json({ error: 'INVALID_COVERING_STAFF' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the original shift row so we don't race a parallel cover.
    const origRes = await client.query<ShiftRow>(
      `SELECT id, staff_id, starts_at, ends_at, status, location_id
         FROM shifts
        WHERE id = $1
        FOR UPDATE`,
      [originalShiftId],
    );
    const orig = origRes.rows[0];
    if (!orig) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SHIFT_NOT_FOUND' }, { status: 404 });
    }
    if (orig.status === 'cancelled' || orig.status === 'missed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SHIFT_NOT_COVERABLE', status: orig.status }, { status: 409 });
    }
    if (orig.staff_id === coveringStaffId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'CANT_COVER_SELF' }, { status: 400 });
    }

    const startsAt = body.startsAt ? new Date(body.startsAt) : orig.starts_at;
    const endsAt = body.endsAt ? new Date(body.endsAt) : orig.ends_at;
    if (!(endsAt > startsAt)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'INVALID_WINDOW' }, { status: 400 });
    }

    // Step 1 — cancel the original.
    await client.query(
      `UPDATE shifts
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1`,
      [originalShiftId],
    );

    // Step 2 — insert the cover shift. The btree_gist exclusion constraint
    // will raise if the covering staff has an overlapping non-cancelled shift.
    let coverShiftId: number | null = null;
    try {
      const insRes = await client.query<{ id: number }>(
        `INSERT INTO shifts
           (staff_id, starts_at, ends_at, status, covers_shift_id, location_id, notes, created_by)
         VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7)
         RETURNING id`,
        [coveringStaffId, startsAt, endsAt, originalShiftId, orig.location_id, body.notes ?? null, me.staffId],
      );
      coverShiftId = insRes.rows[0]?.id ?? null;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23P01') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'COVER_OVERLAPS_EXISTING_SHIFT' }, { status: 409 });
      }
      throw err;
    }

    // Step 3 — revoke any open sessions for the covered staff so they're
    // signed out of the workstation immediately.
    const revoked = await client.query(
      `UPDATE staff_sessions
          SET revoked_at = NOW()
        WHERE staff_id = $1 AND revoked_at IS NULL
        RETURNING sid`,
      [orig.staff_id],
    );

    await client.query('COMMIT');

    await audit({
      staffId: me.staffId,
      event: 'shift.cover',
      result: 'ok',
      detail: {
        originalShiftId,
        coverShiftId,
        coveredStaffId: orig.staff_id,
        coveringStaffId,
        sessionsRevoked: revoked.rowCount ?? 0,
      },
    });

    return NextResponse.json({
      ok: true,
      coverShiftId,
      coveredStaffId: orig.staff_id,
      coveringStaffId,
      sessionsRevoked: revoked.rowCount ?? 0,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* ignore */ });
    console.error('[/api/shifts/:id/cover] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
