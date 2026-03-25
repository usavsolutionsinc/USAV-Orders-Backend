import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishTechLogChanged } from '@/lib/realtime/publish';
import { performTechFnskuScan } from '@/lib/tech/performTechFnskuScan';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fnskuParam = searchParams.get('fnsku');
  const techId = searchParams.get('techId');

  if (!fnskuParam) {
    return NextResponse.json({ error: 'FNSKU is required' }, { status: 400 });
  }

  if (!techId) {
    return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const fnsku = fnskuParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const techIdNum = parseInt(techId, 10);
    if (!techIdNum) {
      return NextResponse.json({ error: 'Invalid Tech ID' }, { status: 400 });
    }

    await client.query('BEGIN');

    const staffResult = await client.query(`SELECT id FROM staff WHERE id = $1 LIMIT 1`, [techIdNum]);
    if (staffResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Tech not found in staff table' }, { status: 404 });
    }
    const testedBy = staffResult.rows[0].id as number;

    let payload;
    try {
      payload = await performTechFnskuScan(client, { fnsku, testedBy });
    } catch (e: unknown) {
      const err = e as { code?: string };
      await client.query('ROLLBACK');
      if (err?.code === 'FNSKU_NOT_FOUND') {
        return NextResponse.json({ found: false, error: 'FNSKU not found in fba_fnskus table' });
      }
      throw e;
    }

    await client.query('COMMIT');
    await invalidateCacheTags(['tech-logs', 'orders-next']);
    await publishTechLogChanged({
      techId: testedBy,
      action: 'update',
      rowId: payload.fnskuLogId,
      source: 'tech.scan-fnsku',
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error scanning FNSKU:', error);
    return NextResponse.json(
      {
        error: 'Failed to scan FNSKU',
        details: message,
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
