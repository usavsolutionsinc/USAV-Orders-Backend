import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { createStationScanSession } from '@/lib/station-scan-session';
import { resolveStaffIdFromTechParam } from '@/lib/tech/resolveStaffIdFromTechParam';
import { appendRepairStatusHistory, getRepairById } from '@/lib/neon/repair-service-queries';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';

const ROUTE = 'tech.scan-repair-station';
const REPAIR_TAGS = ['repair-service'];

function parseRepairId(repairScan: string): number | null {
  const m = String(repairScan || '').trim().toUpperCase().match(/^RS-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

    const repairScan = String(body?.repairScan || '').trim();
    const techId = body?.techId;
    const userName = body?.userName != null ? String(body.userName) : null;
    const repairIdBody = body?.repairId != null ? Number(body.repairId) : null;

    const repairId = repairIdBody && repairIdBody > 0 ? repairIdBody : parseRepairId(repairScan);
    if (!repairId) {
      return NextResponse.json({ success: false, error: 'Valid RS- id or repairId is required' }, { status: 400 });
    }
    if (!techId) {
      return NextResponse.json({ success: false, error: 'techId is required' }, { status: 400 });
    }

    const staffId = await resolveStaffIdFromTechParam(pool, techId);
    if (!staffId) {
      return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
    }

    const repair = await getRepairById(repairId);
    if (!repair) {
      return NextResponse.json({ success: false, error: 'Repair not found' }, { status: 404 });
    }

    await appendRepairStatusHistory(repairId, {
      status: 'station_testing_scan',
      source: 'station-testing.scan',
      user_id: Number.isFinite(Number(techId)) ? Number(techId) : null,
      user_name: userName,
      metadata: {
        scanned_input: repairScan.toUpperCase(),
        screen: 'StationTesting',
        station: 'TECH',
      },
    });

    await invalidateCacheTags(REPAIR_TAGS);
    await publishRepairChanged({ repairIds: [repairId], source: 'tech.scan-repair-station' });

    const scanSessionId = await createStationScanSession(pool, {
      staffId,
      sessionKind: 'REPAIR',
      repairServiceId: repairId,
      trackingRaw: `RS-${repairId}`,
      trackingKey18: null,
    });

    const out: Record<string, unknown> = {
      success: true,
      repair,
      scanSessionId,
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
    console.error('POST /api/tech/scan-repair-station:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to record repair scan', details: message },
      { status: 500 },
    );
  }
}
