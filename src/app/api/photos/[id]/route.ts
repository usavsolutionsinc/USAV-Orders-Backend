import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import type { PermissionString } from '@/lib/auth/permissions-shared';

/**
 * DELETE /api/photos/[id] — unified photo delete across every entity_type
 * stored in the `photos` table. Permission required varies by entity_type:
 * the caller doesn't need to know which sub-endpoint to call.
 */

const PERM_BY_ENTITY_TYPE: Record<string, PermissionString> = {
  RECEIVING: 'receiving.upload_photo',
  RECEIVING_LINE: 'receiving.upload_photo',
  PACKER_LOG: 'packing.complete_order',
  SKU: 'receiving.upload_photo',
  SKU_STOCK: 'sku_stock.adjust',
  BIN_ADJUSTMENT: 'bin.adjust',
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid photo id is required' }, { status: 400 });
  }

  const existing = await pool.query<{ entity_type: string; url: string }>(
    `SELECT entity_type, url FROM photos WHERE id = $1`,
    [id],
  );
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { entity_type: entityType, url: photoUrl } = existing.rows[0];
  const perm = PERM_BY_ENTITY_TYPE[entityType];
  if (!perm) {
    return NextResponse.json(
      { error: `Unsupported entity_type: ${entityType}` },
      { status: 400 },
    );
  }

  const gate = await requireRoutePerm(request, perm);
  if (gate.denied) return gate.denied;

  await pool.query(`DELETE FROM photos WHERE id = $1`, [id]);

  if (photoUrl.includes('blob.vercel-storage.com') || photoUrl.includes('vercel-storage')) {
    try { await del(photoUrl); } catch { /* non-fatal */ }
  }

  return NextResponse.json({ success: true, id, entityType });
}
