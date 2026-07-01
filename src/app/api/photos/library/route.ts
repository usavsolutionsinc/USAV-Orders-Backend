import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { listPhotoLibrary, libraryFiltersFromSearchParams } from '@/lib/photos/queries/library';
import {
  listOutboundDocumentLibrary,
  outboundLibraryFiltersFromSearchParams,
} from '@/lib/documents/queries/library';
import { searchPhotos } from '@/lib/photos/queries/search';
import { photoContentUrl } from '@/lib/photos/display-url';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const params = new URL(req.url).searchParams;
    const sourceScope = params.get('sourceScope');

    if (sourceScope === 'outbound') {
      const cursor = params.get('cursor') ? Number(params.get('cursor')) : null;
      const limit = params.get('limit') ? Number(params.get('limit')) : 48;

      if (params.get('outboundMedia') === 'pack_photos') {
        const { items, nextCursor, hasMore } = await listPhotoLibrary({
          organizationId: ctx.organizationId,
          cursor,
          limit,
          entityType: 'PACKER_LOG',
          ...libraryFiltersFromSearchParams(params),
        });
        const photos = items.map((p) => ({
          ...p,
          displayUrl: p.url?.startsWith('/api/photos/') ? p.url : photoContentUrl(p.id),
          thumbUrl: photoContentUrl(p.id, 'thumb'),
          hasAnalysis: p.hasAnalysis ?? false,
          damageDetected: p.damageDetected ?? null,
          sourceScope: 'outbound' as const,
        }));
        return NextResponse.json({ photos, nextCursor, hasMore });
      }

      const { items, nextCursor, hasMore } = await listOutboundDocumentLibrary({
        organizationId: ctx.organizationId,
        cursor,
        limit,
        ...outboundLibraryFiltersFromSearchParams(params),
      });
      return NextResponse.json({ photos: items, nextCursor, hasMore });
    }

    const cursor = params.get('cursor') ? Number(params.get('cursor')) : null;
    const limit = params.get('limit') ? Number(params.get('limit')) : 48;
    const q = params.get('q')?.trim() || null;
    const damageRaw = params.get('damageDetected');

    // Only free-text `q` needs the dedicated text-search path; the damage
    // quick-filter now composes with every structured/business-ID filter on the
    // main list path (and gains pagination + the full photo shape there).
    if (q) {
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
      ...libraryFiltersFromSearchParams(params),
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
