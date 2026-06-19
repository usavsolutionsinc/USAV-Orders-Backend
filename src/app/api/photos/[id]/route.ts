import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import type { PermissionString } from '@/lib/auth/permissions-shared';
import { deletePhoto } from '@/lib/photos/service';

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
  SERIAL_UNIT: 'tech.scan_serial',
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

  const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const actor = await getCurrentUserBySid(sid);
  if (!actor) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const orgId = actor.organizationId;

  const existing = await tenantQuery<{ entity_type: string }>(
    orgId,
    `SELECT l.entity_type
       FROM photos p
       JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
      WHERE p.id = $1 AND p.organization_id = $2 AND l.link_role = 'primary'
      ORDER BY l.id ASC
      LIMIT 1`,
    [id, orgId],
  );
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { entity_type: entityType } = existing.rows[0];
  const perm = PERM_BY_ENTITY_TYPE[entityType];
  if (!perm) {
    return NextResponse.json(
      { error: `Unsupported entity_type: ${entityType}` },
      { status: 400 },
    );
  }

  const gate = await requireRoutePerm(request, perm);
  if (gate.denied) return gate.denied;

  await deletePhoto(id, orgId);

  return NextResponse.json({ success: true, id, entityType });
}
