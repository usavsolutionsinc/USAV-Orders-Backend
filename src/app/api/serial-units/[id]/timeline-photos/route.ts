import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { listUnitTimelinePhotos } from '@/lib/photos/queries/unit-timeline-photos';

export const dynamic = 'force-dynamic';

/**
 * GET /api/serial-units/[id]/timeline-photos
 *
 * The unit's photos for its detail-pane photo timeline, in two tagged buckets:
 * testing-scan photos (SERIAL_UNIT · testing_photo) and the paired receiving
 * UNBOX photos reached via serial_unit_provenance → receiving_lines. Read-only.
 * The `[id]` segment resolves numeric id / serial / minted unit_uid, org-scoped.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */

function extractIdSegment(pathname: string): string {
  const m = /\/api\/serial-units\/([^/]+)\/timeline-photos/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}

async function resolveUnitId(raw: string, orgId: string): Promise<number | null> {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const r = await tenantQuery<{ id: number }>(
      orgId,
      `SELECT id FROM serial_units WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [Number(raw), orgId],
    );
    if (r.rows[0]) return Number(r.rows[0].id);
  }
  const bySerial = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) AND organization_id = $2 LIMIT 1`,
    [raw, orgId],
  );
  if (bySerial.rows[0]) return Number(bySerial.rows[0].id);
  const byUid = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM serial_units WHERE unit_uid = $1 AND organization_id = $2 LIMIT 1`,
    [raw, orgId],
  );
  return byUid.rows[0] ? Number(byUid.rows[0].id) : null;
}

export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    try {
      const serialUnitId = await resolveUnitId(
        extractIdSegment(request.nextUrl.pathname),
        ctx.organizationId,
      );
      if (!serialUnitId) {
        return NextResponse.json({ success: false, error: 'Serial unit not found' }, { status: 404 });
      }
      const photos = await listUnitTimelinePhotos(ctx.organizationId, serialUnitId);
      return NextResponse.json({ success: true, photos });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load unit timeline photos';
      console.error('GET /api/serial-units/[id]/timeline-photos:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.view' },
);
