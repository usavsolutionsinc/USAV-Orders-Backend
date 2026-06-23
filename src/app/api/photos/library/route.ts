import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { listPhotoLibrary } from '@/lib/photos/queries/library';
import { searchPhotos } from '@/lib/photos/queries/search';
import { photoContentUrl } from '@/lib/photos/display-url';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const params = new URL(req.url).searchParams;
    const cursor = params.get('cursor') ? Number(params.get('cursor')) : null;
    const limit = params.get('limit') ? Number(params.get('limit')) : 48;
    const receivingId = params.get('receivingId') ? Number(params.get('receivingId')) : null;
    const entityId = params.get('entityId') ? Number(params.get('entityId')) : null;
    const staffId = params.get('staffId') ? Number(params.get('staffId')) : null;
    const sort = params.get('sort');
    const hasAnalysisRaw = params.get('hasAnalysis');
    const q = params.get('q')?.trim() || null;
    const damageRaw = params.get('damageDetected');

    if (q || damageRaw) {
      const rows = await searchPhotos({
        organizationId: ctx.organizationId,
        poRef: params.get('poRef'),
        dateFrom: params.get('dateFrom'),
        dateTo: params.get('dateTo'),
        q,
        damageDetected:
          damageRaw === 'true' ? true : damageRaw === 'false' ? false : null,
        limit,
      });
      return NextResponse.json({
        photos: rows.map((p) => ({
          id: p.id,
          poRef: p.poRef,
          photoType: p.photoType,
          createdAt: p.createdAt,
          displayUrl: photoContentUrl(p.id),
          thumbUrl: p.thumbUrl,
          damageDetected: p.damageDetected,
          caption: p.caption,
        })),
        nextCursor: null,
        hasMore: false,
      });
    }

      const { items, nextCursor, hasMore } = await listPhotoLibrary({
        organizationId: ctx.organizationId,
        cursor,
        limit,
        dateFrom: params.get('dateFrom'),
        dateTo: params.get('dateTo'),
        sort: sort === 'oldest' ? 'oldest' : 'recent',
        entityType: params.get('entityType'),
        entityId,
      linkRole: params.get('linkRole'),
      poRef: params.get('poRef'),
      receivingId,
      // Split RECEIVING-linked photos by receiving.source: local pickups vs the
      // rest (unboxing). See library-filter-state.receivingSourceForScope.
      receivingSource: params.get('receivingSource'),
      receivingSourceExclude: params.get('receivingSourceExclude'),
      staffId,
      folderId: params.get('folderId') ? Number(params.get('folderId')) : null,
      hasAnalysis:
        hasAnalysisRaw === 'true' ? true : hasAnalysisRaw === 'false' ? false : null,
    });

    const photos = items.map((p) => ({
      ...p,
      displayUrl: p.url?.startsWith('/api/photos/')
        ? p.url
        : photoContentUrl(p.id),
      thumbUrl: photoContentUrl(p.id, 'thumb'),
      hasAnalysis: p.hasAnalysis ?? false,
      damageDetected: p.damageDetected ?? null,
      legacyUrl: p.url && !p.url.startsWith('/api/photos/')
        ? normalizePhotoDisplayUrl(p.url)
        : null,
    }));

    return NextResponse.json({ photos, nextCursor, hasMore });
  } catch (error) {
    return errorResponse(error, 'GET /api/photos/library');
  }
}, { permission: 'photos.view' });
