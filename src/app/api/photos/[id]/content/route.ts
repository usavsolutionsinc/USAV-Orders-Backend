import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserBySid } from '@/lib/auth/current-user';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { getPrimaryPhotoStorage } from '@/lib/photos/storage/resolve-primary';
import { getStorageAdapter } from '@/lib/photos/storage/registry';
import { readPhotoBytesById } from '@/lib/photos/read-bytes';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

export const dynamic = 'force-dynamic';

const TTL = Number(process.env.PHOTOS_SIGNED_URL_TTL_SECONDS || 3600);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const photoId = Number(idParam);
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return NextResponse.json({ error: 'Valid photo id is required' }, { status: 400 });
  }

  const variant = new URL(request.url).searchParams.get('variant') === 'thumb' ? 'thumb' : 'full';

  const sid = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const actor = await getCurrentUserBySid(sid);

  let organizationId: string | undefined;
  if (actor) {
    organizationId = actor.organizationId;
    const gate = await requireRoutePerm(request, 'photos.view');
    if (gate.denied) {
      // Allow entity-scoped viewers without photos.view — fall through to legacy URL redirect
      organizationId = actor.organizationId;
    }
  }

  const photoRes = organizationId
    ? await tenantQuery<{ organization_id: string }>(
        organizationId,
        `SELECT organization_id FROM photos WHERE id = $1 AND organization_id = $2`,
        [photoId, organizationId],
      )
    : null;

  if (actor && photoRes && photoRes.rowCount === 0) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const orgId = organizationId || photoRes?.rows[0]?.organization_id;
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storage = await getPrimaryPhotoStorage(photoId, orgId);

  if (storage?.provider === 'gcs' && storage.bucket) {
    const key = variant === 'thumb' && storage.thumbObjectKey
      ? storage.thumbObjectKey
      : storage.objectKey;
    try {
      const adapter = getStorageAdapter('gcs');
      const signed = await adapter.getSignedReadUrl({
        bucket: storage.bucket,
        objectKey: key,
        ttlSeconds: TTL,
      });
      return NextResponse.redirect(signed, { status: 302 });
    } catch {
      /* fall through */
    }
  }

  const legacyUrl = storage?.legacyUrl;
  if (legacyUrl && !legacyUrl.startsWith('/api/photos/')) {
    const display = normalizePhotoDisplayUrl(legacyUrl);
    if (display.startsWith('http') || display.startsWith('/')) {
      return NextResponse.redirect(display, { status: 302 });
    }
  }

  if (actor) {
    const bytes = await readPhotoBytesById(photoId, orgId);
    if (bytes) {
      return new NextResponse(Buffer.from(bytes.bytes), {
        headers: {
          'content-type': bytes.contentType,
          'cache-control': 'private, max-age=300',
        },
      });
    }
  }

  return NextResponse.json({ error: 'Photo content unavailable' }, { status: 404 });
}
