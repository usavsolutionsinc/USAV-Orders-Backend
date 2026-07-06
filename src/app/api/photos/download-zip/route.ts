import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import { photoExportBaseName } from '@/lib/photos/display-names';
import { buildStoreZip, type StoreZipEntry } from '@/lib/zip/store-zip';

export const dynamic = 'force-dynamic';

function safeEntryName(base: string, fallback: string): string {
  const cleaned = base.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export async function GET(request: NextRequest) {
  const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const actor = await getCurrentUserBySid(sid);
  if (!actor) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const gate = await requireRoutePerm(request, 'photos.view');
  if (gate.denied) return gate.denied;

  const idsParam = request.nextUrl.searchParams.get('ids')?.trim() ?? '';
  const requestedIds = idsParam
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
  const photoIds = [...new Set(requestedIds)];

  if (photoIds.length === 0) {
    return NextResponse.json({ error: 'At least one photo id is required' }, { status: 400 });
  }

  const verify = await tenantQuery<{ id: number }>(
    actor.organizationId,
    `SELECT id
       FROM photos
      WHERE organization_id = $1
        AND id = ANY($2::bigint[])`,
    [actor.organizationId, photoIds],
  );

  if (verify.rowCount === 0) {
    return NextResponse.json({ error: 'No downloadable photos found' }, { status: 404 });
  }

  const foundIds = new Set(verify.rows.map((row) => Number(row.id)));
  const orderedIds = photoIds.filter((id) => foundIds.has(id));

  const metaRes = await tenantQuery<{
    id: string;
    po_ref: string | null;
    photo_type: string | null;
    ticket_id: string | null;
  }>(
    actor.organizationId,
    `SELECT p.id, p.po_ref, p.photo_type,
            (SELECT lz.entity_id FROM photo_entity_links lz
              WHERE lz.photo_id = p.id
                AND lz.organization_id = p.organization_id
                AND lz.entity_type = 'ZENDESK_TICKET'
              LIMIT 1) AS ticket_id
       FROM photos p
      WHERE p.organization_id = $1
        AND p.id = ANY($2::bigint[])`,
    [actor.organizationId, orderedIds],
  );
  const metaById = new Map(
    metaRes.rows.map((row) => [
      Number(row.id),
      {
        id: Number(row.id),
        poRef: row.po_ref,
        photoType: row.photo_type,
        ticketId: row.ticket_id != null ? Number(row.ticket_id) : null,
      },
    ]),
  );

  const entries: StoreZipEntry[] = [];
  const title = request.nextUrl.searchParams.get('title')?.trim() || 'photos';

  for (let i = 0; i < orderedIds.length; i++) {
    const photoId = orderedIds[i];
    const bytes = await readPhotoBytesById(photoId, actor.organizationId);
    if (!bytes) continue;

    const meta = metaById.get(photoId);
    const exportBase = meta
      ? photoExportBaseName(meta)
      : safeEntryName(bytes.filename, `photo_${photoId}`);
    const fallback = `${exportBase}.jpg`;
    const name = `${String(i + 1).padStart(2, '0')}_${safeEntryName(fallback, fallback)}`;
    entries.push({ name, data: Buffer.from(bytes.bytes) });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No downloadable photos found' }, { status: 404 });
  }

  const blob = buildStoreZip(entries);
  const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'photos';

  return new NextResponse(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safeTitle}.zip"`,
    },
  });
}
