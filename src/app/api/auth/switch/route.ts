/**
 * POST /api/auth/switch
 *
 * Body: { staffId: number, pin: string, deviceKind?: 'station' | 'personal' }
 *
 * Like /signin, but the caller is already authenticated as some OTHER staff.
 * The current session is revoked first (clean audit trail; the prior sid
 * can't be reused even if a copy escaped). A fresh session is created for
 * the new staffId, the cookie is overwritten.
 *
 * Audit event: `signin.switch` with detail.previousStaffId so the chain of
 * "who was here" is recoverable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffPin, PinError } from '@/lib/auth/pin';
import {
  createSession,
  cookieMaxAgeForSession,
  loadSession,
  revokeSession,
  SESSION_COOKIE_NAME,
  type DeviceKind,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import { getOrganizationBySlug } from '@/lib/tenancy/organizations';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

function asDeviceKind(raw: unknown): DeviceKind {
  if (raw === 'personal' || raw === 'station' || raw === 'phone') return raw;
  return 'station';
}

// Tenant fallback for the signin-like (no prior session) path: resolve the org
// from `x-tenant-slug` exactly like the staff-picker, so a switch can never
// cross into another tenant. Apex host → USAV (transitional).
async function resolveOrgId(req: NextRequest): Promise<string> {
  const slug = req.headers.get('x-tenant-slug');
  if (!slug) return USAV_ORG_ID;
  const org = await getOrganizationBySlug(slug);
  return org?.id ?? '00000000-0000-0000-0000-000000000000';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');
  let staffIdForAudit: number | null = null;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const staffId = Number((body as { staffId?: unknown }).staffId);
    const pin = String((body as { pin?: unknown }).pin ?? '');
    const deviceKind = asDeviceKind((body as { deviceKind?: unknown }).deviceKind);
    const deviceLabel = ((body as { deviceLabel?: unknown }).deviceLabel ?? null) as string | null;

    if (!Number.isFinite(staffId) || staffId <= 0) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'staffId' }, { status: 400 });
    }
    staffIdForAudit = staffId;
    if (!pin) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'pin' }, { status: 400 });
    }

    // Read the current sid (if any) so we can revoke it once the new
    // session is minted. Don't require a current session — a /signin-like
    // flow should still work if the cookie was cleared in another tab.
    const prevSid = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const prev = prevSid ? await loadSession(prevSid) : null;

    // Tenant scope: you may only switch to a staff member in the SAME org as
    // your current session (or, signin-like with no prior session, the org of
    // the request's tenant). A cross-org staffId reads as NOT_FOUND → 404,
    // so a station bound to org A can't pivot into org B even with a leaked PIN.
    const targetOrgId = prev?.organizationId ?? (await resolveOrgId(req));
    const row = await verifyStaffPin(staffId, pin, targetOrgId);
    if (row.status !== 'active') {
      await audit({
        staffId, event: 'signin.switch', result: 'denied', ip, userAgent: ua,
        detail: { reason: 'status', status: row.status, previousStaffId: prev?.staffId ?? null },
      });
      return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE', status: row.status }, { status: 403 });
    }

    const session = await createSession({
      staffId,
      deviceKind,
      deviceLabel,
      ip,
      userAgent: ua,
    });

    // Revoke the previous session AFTER the new one is created so a crash
    // between the two doesn't leave the user stranded.
    if (prev && prev.staffId !== staffId) {
      await revokeSession(prev.sid);
    }

    await audit({
      staffId, sid: session.sid,
      event: 'signin.switch', result: 'ok',
      ip, userAgent: ua,
      detail: {
        deviceKind,
        previousStaffId: prev?.staffId ?? null,
        previousSid: prev?.sid ?? null,
      },
    });

    const res = NextResponse.json({
      ok: true,
      staffId,
      role: row.role,
      name: row.name,
      session: { sid: session.sid, deviceKind: session.deviceKind, expiresAt: session.expiresAt },
    });
    res.cookies.set(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: cookieMaxAgeForSession(session),
    });
    return res;
  } catch (err) {
    if (err instanceof PinError) {
      await audit({
        staffId: staffIdForAudit, event: 'signin.switch', result: 'denied', ip, userAgent: ua,
        detail: { code: err.code },
      });
      const status = err.code === 'NOT_FOUND' ? 404
        : err.code === 'NO_PIN' ? 409
        : 401;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error('[/api/auth/switch] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
