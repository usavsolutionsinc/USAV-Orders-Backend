/**
 * PIN management.
 *
 *   POST  /api/auth/pin   — set or change PIN
 *     Body: { pin: string, currentPin?: string, staffId?: number }
 *
 *     - Self-change: omit staffId; currentPin required if a PIN already
 *       exists (re-verify before swap).
 *     - Admin set/reset: pass staffId; requires admin.manage_staff permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { hashPin, PinError, setStaffPin, verifyStaffPin } from '@/lib/auth/pin';
import { getCurrentUser } from '@/lib/auth/current-user';
import { audit } from '@/lib/auth/audit';
import pool from '@/lib/db';

export const runtime = 'nodejs';

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip') || null;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const pin = String((body as { pin?: unknown }).pin ?? '');
    const currentPin = (body as { currentPin?: unknown }).currentPin
      ? String((body as { currentPin: unknown }).currentPin)
      : null;
    const explicitStaffId = (body as { staffId?: unknown }).staffId !== undefined
      ? Number((body as { staffId: unknown }).staffId)
      : null;

    const me = await getCurrentUser();
    let targetStaffId: number | null = null;
    let isAdminReset = false;

    if (explicitStaffId !== null) {
      if (!me) {
        return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      }
      if (!me.permissions.has('admin.manage_staff')) {
        return NextResponse.json({ error: 'FORBIDDEN', permission: 'admin.manage_staff' }, { status: 403 });
      }
      targetStaffId = explicitStaffId;
      isAdminReset = true;
    } else {
      if (!me) {
        return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      }
      targetStaffId = me.staffId;
    }

    if (!Number.isFinite(targetStaffId!) || targetStaffId! <= 0) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'staffId' }, { status: 400 });
    }
    if (!pin) {
      return NextResponse.json({ error: 'INVALID_REQUEST', field: 'pin' }, { status: 400 });
    }

    // Tenant scope (CVE class: IDOR cross-tenant PIN reset → account takeover).
    // BOTH the self-change and admin-reset target must belong to the CALLER's
    // org. Probe the target row scoped to me.organizationId: a cross-org id
    // (the admin-reset IDOR) reads as NOT_FOUND and 404s BEFORE any mutation.
    // `me` is guaranteed non-null above — both branches 401 when it's missing.
    const callerOrgId = me!.organizationId;
    const probe = await pool.query(
      `SELECT pin_hash FROM staff WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [targetStaffId, callerOrgId],
    );
    const targetRow = probe.rows[0] as { pin_hash: string | null } | undefined;
    if (!targetRow) {
      // Either no such staff, or it belongs to another tenant. Same 404 either
      // way — never reveal cross-org existence.
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    if (!isAdminReset) {
      // Self-change: if a PIN already exists, current PIN must verify first.
      const hasExisting = !!targetRow.pin_hash;
      if (hasExisting) {
        if (!currentPin) {
          return NextResponse.json({ error: 'CURRENT_PIN_REQUIRED' }, { status: 400 });
        }
        try {
          await verifyStaffPin(targetStaffId!, currentPin, callerOrgId);
        } catch (err) {
          if (err instanceof PinError) {
            return NextResponse.json({ error: err.code }, { status: 401 });
          }
          throw err;
        }
      }
    }

    // Validate via hashPin's shape check, then persist — org-scoped so a
    // cross-org id can never be written even if the probe above is bypassed.
    await hashPin(pin); // throws PinError for bad shape; result discarded
    await setStaffPin(targetStaffId!, pin, callerOrgId);

    await audit({
      staffId: targetStaffId,
      event: isAdminReset ? 'pin.reset' : 'pin.set',
      result: 'ok',
      ip, userAgent: ua,
      sid: me?.session.sid ?? null,
      detail: { byAdmin: isAdminReset, byStaffId: me?.staffId ?? null },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PinError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    console.error('[/api/auth/pin] error:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
