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
import { audit } from '@/lib/auth/audit';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { withTenantTransaction } from '@/lib/tenancy/db';

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
  const orgId = gate.ctx.organizationId;

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

  // Thrown to force a transaction ROLLBACK and surface a specific HTTP error
  // for cases that occur AFTER a write has happened inside the transaction.
  class CoverAbort extends Error {
    constructor(public body: Record<string, unknown>, public status: number) {
      super('CoverAbort');
    }
  }

  try {
    // shifts has no own organization_id — the cover transaction is scoped via
    // the parent staff row. The org GUC is set by withTenantTransaction.
    const outcome = await withTenantTransaction(orgId, async (client) => {
      // Lock the original shift row so we don't race a parallel cover. Org
      // ownership is enforced via the parent staff row (404 on mismatch).
      const origRes = await client.query<ShiftRow>(
        `SELECT id, staff_id, starts_at, ends_at, status, location_id
           FROM shifts
          WHERE id = $1
            AND staff_id IN (SELECT id FROM staff WHERE organization_id = $2)
          FOR UPDATE`,
        [originalShiftId, orgId],
      );
      const orig = origRes.rows[0];
      if (!orig) {
        // No write yet — return the response and let the txn commit empty.
        return { kind: 'response' as const, response: NextResponse.json({ error: 'SHIFT_NOT_FOUND' }, { status: 404 }) };
      }
      if (orig.status === 'cancelled' || orig.status === 'missed') {
        return { kind: 'response' as const, response: NextResponse.json({ error: 'SHIFT_NOT_COVERABLE', status: orig.status }, { status: 409 }) };
      }
      if (orig.staff_id === coveringStaffId) {
        return { kind: 'response' as const, response: NextResponse.json({ error: 'CANT_COVER_SELF' }, { status: 400 }) };
      }

      const startsAt = body.startsAt ? new Date(body.startsAt) : orig.starts_at;
      const endsAt = body.endsAt ? new Date(body.endsAt) : orig.ends_at;
      if (!(endsAt > startsAt)) {
        return { kind: 'response' as const, response: NextResponse.json({ error: 'INVALID_WINDOW' }, { status: 400 }) };
      }

      // Verify the covering staff belongs to this org before any write —
      // shifts has no org column to stamp, so the guard is on the parent staff.
      const coverStaffRes = await client.query<{ id: number }>(
        `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
        [coveringStaffId, orgId],
      );
      if (coverStaffRes.rows.length === 0) {
        return { kind: 'response' as const, response: NextResponse.json({ error: 'INVALID_COVERING_STAFF' }, { status: 404 }) };
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
          // Already wrote (cancel) — throw to roll the whole txn back.
          throw new CoverAbort({ error: 'COVER_OVERLAPS_EXISTING_SHIFT' }, 409);
        }
        throw err;
      }

      // Step 3 — revoke any open sessions for the covered staff so they're
      // signed out of the workstation immediately. orig.staff_id is already
      // org-verified above.
      const revoked = await client.query(
        `UPDATE staff_sessions
            SET revoked_at = NOW()
          WHERE staff_id = $1 AND revoked_at IS NULL
          RETURNING sid`,
        [orig.staff_id],
      );

      return {
        kind: 'ok' as const,
        coverShiftId,
        coveredStaffId: orig.staff_id,
        sessionsRevoked: revoked.rowCount ?? 0,
      };
    });

    if (outcome.kind === 'response') {
      return outcome.response;
    }

    await audit({
      staffId: me.staffId,
      event: 'shift.cover',
      result: 'ok',
      detail: {
        originalShiftId,
        coverShiftId: outcome.coverShiftId,
        coveredStaffId: outcome.coveredStaffId,
        coveringStaffId,
        sessionsRevoked: outcome.sessionsRevoked,
      },
    });

    return NextResponse.json({
      ok: true,
      coverShiftId: outcome.coverShiftId,
      coveredStaffId: outcome.coveredStaffId,
      coveringStaffId,
      sessionsRevoked: outcome.sessionsRevoked,
    });
  } catch (err) {
    if (err instanceof CoverAbort) {
      return NextResponse.json(err.body, { status: err.status });
    }
    console.error('[/api/shifts/:id/cover] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
