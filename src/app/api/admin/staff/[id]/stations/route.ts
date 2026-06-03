/**
 * GET /api/admin/staff/[id]/stations  — list a staff's station assignments
 * PUT /api/admin/staff/[id]/stations  — REPLACE the staff's station set
 *
 * Body for PUT: { primary: Station | null, secondary: Station[] }
 *   Station ∈ TECH | PACK | UNBOX | SALES | FBA
 *
 * The primary is the single locked station shown in the header goal chip;
 * secondaries are the switchable extras. Passing primary:null clears all
 * assignments (the staffer falls back to the employee_id-derived station, no
 * switch). Idempotent replace, gated by admin.manage_staff.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { asStation, getStaffStations, setStaffStations, type StationKey } from '@/lib/neon/staff-stations-queries';

export const runtime = 'nodejs';

function staffIdFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'stations') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (req: NextRequest) => {
  const staffId = staffIdFromUrl(req);
  if (!staffId) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  const rows = await getStaffStations(staffId);
  const primary = rows.find((r) => r.is_primary)?.station ?? null;
  const secondary = rows.filter((r) => !r.is_primary).map((r) => r.station);
  return NextResponse.json({ primary, secondary });
}, { permission: 'admin.manage_staff' });

export const PUT = withAuth(async (req: NextRequest, ctx) => {
  const staffId = staffIdFromUrl(req);
  if (!staffId) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const primaryRaw = (body as { primary?: unknown }).primary;
  const secondaryRaw = (body as { secondary?: unknown }).secondary;

  let primary: StationKey | null = null;
  if (primaryRaw != null) {
    primary = asStation(primaryRaw);
    if (!primary) return NextResponse.json({ error: 'INVALID_STATION', field: 'primary' }, { status: 400 });
  }

  const secondary: StationKey[] = [];
  if (secondaryRaw != null) {
    if (!Array.isArray(secondaryRaw)) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'secondary' }, { status: 400 });
    }
    for (const v of secondaryRaw) {
      const st = asStation(v);
      if (!st) return NextResponse.json({ error: 'INVALID_STATION', field: 'secondary' }, { status: 400 });
      secondary.push(st);
    }
  }

  // A secondary set with no primary is meaningless — there'd be nothing locked.
  if (!primary && secondary.length > 0) {
    return NextResponse.json({ error: 'PRIMARY_REQUIRED' }, { status: 400 });
  }

  const probe = await pool.query(`SELECT id FROM staff WHERE id = $1`, [staffId]);
  if (!probe.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const result = await setStaffStations(staffId, primary, secondary, ctx.staffId ?? null);

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'staff.stations.changed', result: 'ok',
    detail: { targetStaffId: staffId, primary: result.primary, secondary: result.secondary },
  });

  return NextResponse.json({ ok: true, ...result });
}, { permission: 'admin.manage_staff' });
