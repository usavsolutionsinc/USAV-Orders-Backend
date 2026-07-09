import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { listPhotoLibraryIds, libraryFiltersFromSearchParams } from '@/lib/photos/queries/library';

export const dynamic = 'force-dynamic';

/**
 * GET /api/photos/library/ids — "select all matching filters" support. Returns
 * the total row count for the SAME filter set as /api/photos/library, plus up to
 * `cap` (default 500, hard max 2000) photo ids. `capped` = the id list is a
 * prefix of a larger match set. Shares the library WHERE builder so the ids can
 * never select a different set than the visible grid.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    try {
      const params = new URL(req.url).searchParams;
      const capRaw = params.get('cap');
      const cap = capRaw && Number.isFinite(Number(capRaw)) ? Number(capRaw) : 500;

      const { ids, total, capped } = await listPhotoLibraryIds(
        { organizationId: ctx.organizationId, ...libraryFiltersFromSearchParams(params) },
        { cap },
      );

      return NextResponse.json({ ids, total, capped });
    } catch (error) {
      return errorResponse(error, 'GET /api/photos/library/ids');
    }
  },
  { permission: 'photos.view' },
);
