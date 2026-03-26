import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { getValidStationScanSession, trackingMatchesSession } from '@/lib/station-scan-session';
import { insertTechSerialForTracking } from '@/lib/tech/insertTechSerialForTracking';
import { resolveStaffIdFromTechParam } from '@/lib/tech/resolveStaffIdFromTechParam';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

const ROUTE = 'tech.add-serial';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idemKey = readIdempotencyKey(req, body?.idempotencyKey);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE);
      if (hit && hit.status_code === 200) {
        return NextResponse.json(hit.response_body, { status: 200 });
      }
    }

    const tracking = String(body?.tracking || '').trim();
    const serial = String(body?.serial || '').trim();
    const techId = body?.techId;
    const allowFbaDuplicates = Boolean(body?.allowFbaDuplicates);
    const scanSessionId = body?.scanSessionId != null ? String(body.scanSessionId).trim() : '';

    if (!serial || !techId) {
      return NextResponse.json(
        { success: false, error: 'serial and techId are required' },
        { status: 400 },
      );
    }

    const staffId = await resolveStaffIdFromTechParam(pool, techId);
    if (!staffId) {
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    if (scanSessionId) {
      const sess = await getValidStationScanSession(pool, scanSessionId, staffId);
      if (!sess) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired scan session — scan tracking again.' },
          { status: 400 },
        );
      }
      if (sess.session_kind === 'REPAIR') {
        return NextResponse.json(
          { success: false, error: 'Repair session cannot accept serial scans here.' },
          { status: 400 },
        );
      }

      const anchorTracking = String(sess.tracking_raw || '').trim();
      const key18ForMatch = normalizeTrackingKey18(tracking || anchorTracking);
      if (
        tracking
        && !trackingMatchesSession(sess, tracking, key18ForMatch)
        && sess.session_kind !== 'FNSKU'
      ) {
        return NextResponse.json(
          { success: false, error: 'Tracking does not match the active scan session.' },
          { status: 400 },
        );
      }
    }

    const result = await insertTechSerialForTracking(pool, {
      serial,
      techId,
      allowFbaDuplicates,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    const out = {
      success: true,
      serialNumbers: result.serialNumbers,
      serialType: result.serialType,
      isComplete: false,
      scanSessionId: scanSessionId || null,
    };

    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE,
        staffId,
        statusCode: 200,
        responseBody: out,
      });
    }

    return NextResponse.json(out);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error adding serial:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add serial', details: message },
      { status: 500 },
    );
  }
}
