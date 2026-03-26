import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { photos } from '@/lib/drizzle/schema';
import { and, eq, asc } from 'drizzle-orm';

/**
 * GET /api/packing-logs/photos?packerLogId=X
 *
 * Returns all photos associated with a packer_logs row.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const packerLogId = searchParams.get('packerLogId');

    if (!packerLogId) {
      return NextResponse.json({ error: 'packerLogId is required' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.entityType, 'PACKER_LOG'),
          eq(photos.entityId, Number(packerLogId))
        )
      )
      .orderBy(asc(photos.createdAt));

    return NextResponse.json({ photos: rows });
  } catch (error: any) {
    console.error('[packing-logs/photos] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch photos', details: error.message },
      { status: 500 }
    );
  }
}
