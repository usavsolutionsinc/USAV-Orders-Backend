import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { sqlReceivingPhotoCount } from '@/lib/photos/queries/receiving-list';

/**
 * GET /api/receiving/triage/done — cartons staged + saved for unbox
 * (`receiving.triage_complete = true`), newest-completed first.
 *
 * Backs BOTH:
 *   - the Done tab (`?triview=done`, `TriageDoneList`)
 *   - the "Staged" badge on the combined Triage tab (`useTriageStagedCartons`,
 *     called with a wide `?limit=` and no `?q=` to build a receiving_id Set)
 *
 * Deliberately a standalone endpoint rather than a new `view=` on the giant
 * `/api/receiving-lines` route — mirrors the existing `unfound-queue`
 * precedent (a separate small query, not a 6th branch through a 2000+ line
 * shared SELECT).
 */
interface DoneRow {
  id: number;
  zoho_purchaseorder_number: string | null;
  tracking_number: string | null;
  source_platform: string | null;
  source: string | null;
  staging_location_id: number | null;
  priority_lane: string | null;
  triage_completed_at: string;
  item_name: string | null;
  sku: string | null;
  photo_count: string;
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);

  const conditions: string[] = ['r.organization_id = $1', 'r.triage_complete = true'];
  const params: unknown[] = [ctx.organizationId];
  let idx = 2;

  if (q) {
    conditions.push(
      `(rl.item_name ILIKE $${idx} OR rl.sku ILIKE $${idx} OR r.zoho_purchaseorder_number ILIKE $${idx} OR stn.tracking_number_raw ILIKE $${idx})`,
    );
    params.push(`%${q}%`);
    idx++;
  }

  params.push(limit);

  const sql = `
    SELECT
      r.id,
      r.zoho_purchaseorder_number,
      stn.tracking_number_raw AS tracking_number,
      r.source_platform,
      r.source,
      r.staging_location_id,
      r.priority_lane,
      r.triage_completed_at::text AS triage_completed_at,
      rl.item_name,
      rl.sku,
      ${sqlReceivingPhotoCount('r.id', '$1')} AS photo_count
    FROM receiving r
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
    LEFT JOIN LATERAL (
      SELECT item_name, sku FROM receiving_lines
      WHERE receiving_id = r.id
      ORDER BY id ASC
      LIMIT 1
    ) rl ON true
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.triage_completed_at DESC
    LIMIT $${idx}
  `;

  const result = await tenantQuery<DoneRow>(ctx.organizationId, sql, params);

  return NextResponse.json({
    success: true,
    rows: result.rows,
    total: result.rows.length,
  });
}, { permission: 'receiving.view' });
