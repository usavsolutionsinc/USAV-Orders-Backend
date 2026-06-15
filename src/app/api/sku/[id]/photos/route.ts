import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET  /api/sku/[id]/photos        — list integrity photos for a SKU record
 * POST /api/sku/[id]/photos        — add a photo (base64 or URL) to a SKU record
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(request, 'sku_stock.view');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  const { id } = await params;
  const skuId = Number(id);
  if (!Number.isFinite(skuId) || skuId <= 0) {
    return NextResponse.json({ error: 'Valid SKU id is required' }, { status: 400 });
  }

  try {
    const result = await tenantQuery(
      orgId,
      `SELECT id, entity_id AS sku_id, url, photo_type, taken_by_staff_id, created_at
       FROM photos
       WHERE entity_type = 'SKU' AND entity_id = $1
         AND organization_id = $2
       ORDER BY created_at ASC`,
      [skuId, orgId],
    );

    return NextResponse.json({
      photos: result.rows.map((row: any) => ({
        id: Number(row.id),
        skuId: Number(row.sku_id),
        url: row.url,
        photoType: row.photo_type ?? null,
        takenByStaffId: row.taken_by_staff_id ? Number(row.taken_by_staff_id) : null,
        createdAt: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[sku/[id]/photos GET] error:', err);
    return NextResponse.json({ error: 'Failed to fetch SKU photos' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(request, 'receiving.upload_photo');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  const { id } = await params;
  const skuId = Number(id);
  if (!Number.isFinite(skuId) || skuId <= 0) {
    return NextResponse.json({ error: 'Valid SKU id is required' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const photoBase64: string | undefined = body?.photoBase64;
    const photoUrl: string | undefined = body?.photoUrl;
    const photoType = String(body?.photoType || '').trim() || null;
    // Server-trusted actor — body.takenByStaffId is ignored.
    const takenByStaffId = gate.ctx.staffId;

    if (!photoBase64 && !photoUrl) {
      return NextResponse.json(
        { error: 'Either photoBase64 or photoUrl is required' },
        { status: 400 },
      );
    }

    // Verify the SKU row exists AND belongs to this org — a cross-tenant id
    // finds no row and 404s (never 403), gating the write to owned rows.
    const skuCheck = await tenantQuery(
      orgId,
      'SELECT id FROM sku WHERE id = $1 AND organization_id = $2',
      [skuId, orgId],
    );
    if (skuCheck.rows.length === 0) {
      return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
    }

    let finalUrl = photoUrl;

    if (photoBase64 && !finalUrl) {
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = await put(`sku-photos/${skuId}/${Date.now()}.jpg`, buffer, {
        access: 'public',
        contentType: 'image/jpeg',
      });
      finalUrl = blob.url;
    }

    if (!finalUrl) {
      return NextResponse.json({ error: 'Could not determine photo URL' }, { status: 400 });
    }

    const inserted = await withTenantTransaction(orgId, (client) =>
      client.query(
        `INSERT INTO photos (entity_type, entity_id, url, photo_type, taken_by_staff_id, organization_id)
         VALUES ('SKU', $1, $2, $3, $4, $5)
         ON CONFLICT (entity_type, entity_id, url) DO NOTHING
         RETURNING id, entity_id AS sku_id, url, photo_type, taken_by_staff_id, created_at`,
        [skuId, finalUrl, photoType, takenByStaffId, orgId],
      ),
    );

    const row = inserted.rows[0];
    return NextResponse.json({
      success: true,
      photo: row
        ? {
            id: Number(row.id),
            skuId: Number(row.sku_id),
            url: row.url,
            photoType: row.photo_type ?? null,
            takenByStaffId: row.taken_by_staff_id ? Number(row.taken_by_staff_id) : null,
            createdAt: row.created_at,
          }
        : null,
    });
  } catch (err: any) {
    console.error('[sku/[id]/photos POST] error:', err);
    return NextResponse.json({ error: 'Failed to save SKU photo' }, { status: 500 });
  }
}
