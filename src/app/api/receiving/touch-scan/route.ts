import { NextRequest, NextResponse } from 'next/server';
import { getCarrier } from '@/lib/tracking-format';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { recordReceivingScan } from '@/lib/receiving/record-scan';
import { recordUnboxScanOpened } from '@/lib/receiving/unbox-scan-opened';

/**
 * POST /api/receiving/touch-scan
 * Re-attribute a tracking scan to the signed-in operator without running lookup-po.
 * Used when the client short-circuits to an already-local carton (triage/unbox
 * re-scan) so receiving_scans.scanned_by stays accurate.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const receivingId = Number(body?.receiving_id ?? body?.receivingId);
    const trackingNumber = String(body?.tracking_number ?? body?.trackingNumber ?? '').trim();
    if (!Number.isFinite(receivingId) || receivingId <= 0 || !trackingNumber) {
      return NextResponse.json(
        { success: false, error: 'receiving_id and tracking_number are required' },
        { status: 400 },
      );
    }

    // Org-scope the ownership lookup: a cross-tenant receivingId now resolves to
    // no row → 404 (hides existence), which also gates the recordReceivingScan
    // write below so a caller can't re-attribute a scan onto another org's carton.
    const meta = await tenantQuery<{ source: string | null; carrier: string | null }>(
      ctx.organizationId,
      `SELECT source, carrier FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, ctx.organizationId],
    );
    const row = meta.rows[0];
    if (!row) {
      return NextResponse.json({ success: false, error: 'Receiving carton not found' }, { status: 404 });
    }

    const providedCarrier = String(body?.carrier ?? '').trim();
    const carrier =
      providedCarrier && providedCarrier !== 'Unknown'
        ? providedCarrier
        : row.carrier && row.carrier !== 'Unknown'
          ? row.carrier
          : getCarrier(trackingNumber);
    const source = row.source === 'zoho_po' ? 'zoho_po' : 'unmatched';
    const intakeSurface =
      String(body?.intakeSurface ?? '').trim().toLowerCase() === 'unbox' ? 'unbox' : 'triage';

    const scanId = await recordReceivingScan(
      receivingId,
      trackingNumber,
      carrier,
      ctx.staffId,
      source,
      { intakeSurface },
    );

    if (intakeSurface === 'unbox') {
      await recordUnboxScanOpened(
        ctx.organizationId,
        receivingId,
        ctx.staffId,
        scanId,
        trackingNumber,
      );
    }

    return NextResponse.json({ success: true, scan_id: scanId, receiving_id: receivingId });
  } catch (error) {
    console.error('touch-scan error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'touch-scan failed' },
      { status: 500 },
    );
  }
}, { permission: 'receiving.scan_po' });
