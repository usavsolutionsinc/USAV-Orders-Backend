/**
 * POST /api/auth/signin
 *
 * Body: { staffId: number, pin?: string, deviceKind?: 'station' | 'personal', deviceLabel?: string }
 *
 * Default: verifies the PIN, creates a session, sets the httpOnly `usav_sid`
 * cookie, audits the result. Rate-limited indirectly by the PIN lockout in
 * pin.ts.
 *
 * Pinless mode: when `AUTH_PINLESS_SIGNIN=true`, an empty/missing `pin` skips
 * verification and signs the staff in by name alone (active status still
 * required). Audited as `signin.pinless`. Temporary measure during rollout
 * — flip the env var off to restore the PIN gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifyStaffPin, PinError } from '@/lib/auth/pin';
import {
  createSession,
  cookieMaxAgeForSession,
  SESSION_COOKIE_NAME,
  type DeviceKind,
} from '@/lib/auth/session';
import { audit } from '@/lib/auth/audit';
import { findActiveShift, clockIn } from '@/lib/auth/shift-clock';

export const runtime = 'nodejs';

function isPinlessEnabled(): boolean {
  const v = (process.env.AUTH_PINLESS_SIGNIN ?? '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

function asDeviceKind(raw: unknown): DeviceKind {
  if (raw === 'personal' || raw === 'station' || raw === 'phone') return raw;
  return 'station';
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

    const pinless = !pin && isPinlessEnabled();

    if (!pin && !pinless) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'pin' }, { status: 400 });
    }

    let row: { name: string; role: string; status: string; default_home_path: string | null };
    if (pinless) {
      const lookup = await pool.query<{ name: string; role: string; status: string; default_home_path: string | null }>(
        `SELECT name, role, COALESCE(status, 'active') AS status, default_home_path
           FROM staff
          WHERE id = $1
            AND COALESCE(active, true) = true
          LIMIT 1`,
        [staffId],
      );
      const found = lookup.rows[0];
      if (!found) {
        await audit({
          staffId, event: 'signin.pinless', result: 'denied', ip, userAgent: ua,
          detail: { reason: 'not_found' },
        });
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      row = found;
    } else {
      row = await verifyStaffPin(staffId, pin);
    }
    if (row.status !== 'active') {
      await audit({
        staffId, event: pinless ? 'signin.pinless' : 'signin.pin', result: 'denied', ip, userAgent: ua,
        detail: { reason: 'status', status: row.status },
      });
      return NextResponse.json({ error: 'ACCOUNT_NOT_ACTIVE', status: row.status }, { status: 403 });
    }

    // Sign-in == clock-in (soft gate). Look up an active shift but do NOT
    // reject when there isn't one — staff should always be able to clock in
    // (covering a shift unannounced, working off-hours, etc.). When a shift
    // exists the session expires at shift end; otherwise the device-kind
    // absolute window applies as before.
    const activeShift = await findActiveShift(staffId);

    const session = await createSession({
      staffId,
      deviceKind,
      deviceLabel,
      ip,
      userAgent: ua,
      // Only bind expiry to shift end when a shift is actually present.
      ...(activeShift ? { expiresAt: activeShift.ends_at } : {}),
    });

    // Open the clock-in punch either tied to the shift or off-the-books.
    // clockIn is idempotent (DB unique index + re-fetch on conflict).
    const punch = await clockIn(staffId, activeShift?.id ?? null, 'pin');

    await audit({
      staffId, sid: session.sid, event: pinless ? 'signin.pinless' : 'signin.pin', result: 'ok',
      ip, userAgent: ua,
      detail: {
        deviceKind, deviceLabel, pinless,
        shiftId: activeShift?.id ?? null,
        punchId: punch?.id ?? null,
        unscheduled: !activeShift,
      },
    });

    const res = NextResponse.json({
      ok: true,
      staffId,
      role: row.role,
      name: row.name,
      defaultHomePath: row.default_home_path,
      session: {
        sid: session.sid,
        deviceKind: session.deviceKind,
        expiresAt: session.expiresAt,
      },
      shift: activeShift
        ? { id: activeShift.id, startsAt: activeShift.starts_at, endsAt: activeShift.ends_at }
        : null,
      punchId: punch?.id ?? null,
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
        staffId: staffIdForAudit, event: 'signin.pin', result: 'denied', ip, userAgent: ua,
        detail: { code: err.code },
      });
      const status = err.code === 'NOT_FOUND' ? 404
        : err.code === 'LOCKED' ? 423
        : err.code === 'NO_PIN' ? 409
        : 401;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error('[/api/auth/signin] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
