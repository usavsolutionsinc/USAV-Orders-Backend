import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  getListingGallery,
  addPhotosToListing,
  reorderListing,
  setListingCover,
  removeFromListing,
  ListingTargetError,
  type ListingTarget,
  type ListingGalleryItem,
} from '@/lib/photos/listing-photos';
import { photoContentUrl } from '@/lib/photos/display-url';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Parse the gallery target from `?targetKind=sku|unit&targetId=` (query or body). */
function parseTarget(kindRaw: unknown, idRaw: unknown): ListingTarget | null {
  const kind = kindRaw === 'sku' || kindRaw === 'unit' ? kindRaw : null;
  const id = Number(idRaw);
  if (!kind || !Number.isFinite(id) || id <= 0) return null;
  return { kind, id };
}

/** Attach displayUrl/thumbUrl to each gallery item (same content route as the library). */
function withUrls(items: ListingGalleryItem[]) {
  return items.map((it) => ({
    ...it,
    displayUrl: photoContentUrl(it.photoId),
    thumbUrl: photoContentUrl(it.photoId, 'thumb'),
  }));
}

function targetFromQuery(req: NextRequest): ListingTarget | null {
  const p = new URL(req.url).searchParams;
  return parseTarget(p.get('targetKind'), p.get('targetId'));
}

/** GET /api/photos/listing-gallery?targetKind=sku&targetId=42 — the ordered gallery. */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const target = targetFromQuery(req);
  if (!target) return NextResponse.json({ error: 'Valid targetKind + targetId required' }, { status: 400 });
  const items = await getListingGallery(ctx.organizationId, target);
  return NextResponse.json({ items: withUrls(items) });
}, { permission: 'photos.view' });

/**
 * POST /api/photos/listing-gallery — append photos to a gallery.
 * Body: { targetKind, targetId, photoIds, platformListingId?, serialUnitListingId? }.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const target = parseTarget(body.targetKind, body.targetId);
    if (!target) return NextResponse.json({ error: 'Valid targetKind + targetId required' }, { status: 400 });
    const photoIds = Array.isArray(body.photoIds)
      ? body.photoIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    if (photoIds.length === 0) return NextResponse.json({ error: 'photoIds is required' }, { status: 400 });

    const items = await addPhotosToListing(ctx.organizationId, target, photoIds, {
      platformListingId: body.platformListingId == null ? null : Number(body.platformListingId),
      serialUnitListingId: body.serialUnitListingId == null ? null : Number(body.serialUnitListingId),
    });

    await recordAudit(pool, ctx, req, {
      source: 'listing-gallery-api',
      action: AUDIT_ACTION.LISTING_PHOTO_ADD,
      entityType: AUDIT_ENTITY.LISTING_PHOTO,
      entityId: target.id,
      after: { target, photoIds },
    });

    return NextResponse.json({ items: withUrls(items) }, { status: 201 });
  } catch (error) {
    if (error instanceof ListingTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('POST /api/photos/listing-gallery failed:', error);
    return NextResponse.json({ error: 'Failed to add photos' }, { status: 500 });
  }
}, { permission: 'photos.manage' });

/**
 * PATCH /api/photos/listing-gallery — reorder or set cover.
 * Body: { targetKind, targetId, orderedPhotoIds?, coverPhotoId? }.
 */
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const target = parseTarget(body.targetKind, body.targetId);
    if (!target) return NextResponse.json({ error: 'Valid targetKind + targetId required' }, { status: 400 });

    let items: ListingGalleryItem[];
    if (Array.isArray(body.orderedPhotoIds)) {
      const order = body.orderedPhotoIds.map((n) => Number(n)).filter((n) => Number.isFinite(n));
      items = await reorderListing(ctx.organizationId, target, order);
      await recordAudit(pool, ctx, req, {
        source: 'listing-gallery-api',
        action: AUDIT_ACTION.LISTING_PHOTO_REORDER,
        entityType: AUDIT_ENTITY.LISTING_PHOTO,
        entityId: target.id,
        after: { target, order },
      });
    } else if (body.coverPhotoId != null) {
      const coverPhotoId = Number(body.coverPhotoId);
      items = await setListingCover(ctx.organizationId, target, coverPhotoId);
      await recordAudit(pool, ctx, req, {
        source: 'listing-gallery-api',
        action: AUDIT_ACTION.LISTING_PHOTO_SET_COVER,
        entityType: AUDIT_ENTITY.LISTING_PHOTO,
        entityId: target.id,
        after: { target, coverPhotoId },
      });
    } else {
      return NextResponse.json({ error: 'orderedPhotoIds or coverPhotoId required' }, { status: 400 });
    }

    return NextResponse.json({ items: withUrls(items) });
  } catch (error) {
    if (error instanceof ListingTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('PATCH /api/photos/listing-gallery failed:', error);
    return NextResponse.json({ error: 'Failed to update gallery' }, { status: 500 });
  }
}, { permission: 'photos.manage' });

/** DELETE /api/photos/listing-gallery?targetKind=sku&targetId=42&photoId=7 — remove one photo. */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const p = new URL(req.url).searchParams;
    const target = parseTarget(p.get('targetKind'), p.get('targetId'));
    const photoId = Number(p.get('photoId'));
    if (!target) return NextResponse.json({ error: 'Valid targetKind + targetId required' }, { status: 400 });
    if (!Number.isFinite(photoId) || photoId <= 0) {
      return NextResponse.json({ error: 'Valid photoId required' }, { status: 400 });
    }

    const items = await removeFromListing(ctx.organizationId, target, photoId);

    await recordAudit(pool, ctx, req, {
      source: 'listing-gallery-api',
      action: AUDIT_ACTION.LISTING_PHOTO_REMOVE,
      entityType: AUDIT_ENTITY.LISTING_PHOTO,
      entityId: target.id,
      after: { target, photoId },
    });

    return NextResponse.json({ items: withUrls(items) });
  } catch (error) {
    if (error instanceof ListingTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('DELETE /api/photos/listing-gallery failed:', error);
    return NextResponse.json({ error: 'Failed to remove photo' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
