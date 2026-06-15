/**
 * POST /api/admin/staff/[id]/set-pin
 *
 * Body: { pin: string }
 *
 * Admin pushes a specific PIN for another staff member. Step-up required
 * (auto-detected because the permission is in STEP_UP_PERMISSIONS via the
 * withAuth wrapper — `admin.manage_staff`). On success, clears lockout
 * state and audit-logs `pin.set_by_admin`.
 *
 * Distinct from /reset-pin: this sets a known PIN immediately, no QR/
 * enrollment dance. Useful when admin needs to dictate a PIN in person.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { audit } from '@/lib/auth/audit';
import { isObviousPin, PinError, setStaffPin } from '@/lib/auth/pin';
import { tenantQuery } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function idFromUrl(req: NextRequest): number | null {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'set-pin') - 1;
  if (idx < 0) return null;
  const n = Number(parts[idx]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const id = idFromUrl(req);
  if (!id) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const pin = String((body as { pin?: unknown }).pin ?? '');
  if (!pin) return NextResponse.json({ error: 'INVALID_REQUEST', field: 'pin' }, { status: 400 });
  if (isObviousPin(pin)) {
    return NextResponse.json({ error: 'WEAK_PIN', message: 'PIN is too predictable (sequential or repeating digits).' }, { status: 400 });
  }

  // Org-ownership gate: a staffId in another org reads as NOT_FOUND, never
  // mutated. setStaffPin is also passed the org so its UPDATE re-asserts the
  // org predicate (defense in depth — a cross-org id is a no-op there too).
  const probe = await tenantQuery(
    ctx.organizationId,
    `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`,
    [id, ctx.organizationId],
  );
  if (!probe.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    await setStaffPin(id, pin, ctx.organizationId);
  } catch (err) {
    if (err instanceof PinError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    throw err;
  }

  await audit({
    staffId: ctx.staffId, sid: ctx.session?.sid ?? null,
    event: 'pin.set_by_admin', result: 'ok',
    detail: { targetStaffId: id },
  });

  return NextResponse.json({ ok: true });
}, { permission: 'admin.manage_staff', stepUp: true });
