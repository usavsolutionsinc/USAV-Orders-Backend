import { NextRequest, NextResponse } from 'next/server';
import type { AlbumResult } from '@/lib/google-photos/client';
import {
  processPhoto,
  queryPendingPhotos,
  yesterdayUtc,
} from '@/lib/google-photos/backup';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface BackupSummary {
  date: string;
  scanned: number;
  uploaded: number;
  skipped: number;
  failed: number;
  albums: Array<{ key: string; title: string; productUrl?: string; count: number }>;
  errors: Array<{ photoId: number; message: string }>;
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const date: string = (body?.date as string) || yesterdayUtc();
    const limit: number = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
    const ids: number[] | undefined = Array.isArray(body?.ids)
      ? body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      : undefined;

    const photos = await queryPendingPhotos({ date, limit, ids });
    const summary: BackupSummary = {
      date,
      scanned: photos.length,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      albums: [],
      errors: [],
    };

    if (photos.length === 0) return NextResponse.json(summary);

    const albumCache = new Map<string, AlbumResult>();
    const albumCounts = new Map<string, { title: string; productUrl?: string; count: number }>();

    for (const photo of photos) {
      const result = await processPhoto(photo, date, albumCache);
      const album = albumCounts.get(result.albumKey) ?? {
        title: result.albumTitle,
        productUrl: result.albumUrl,
        count: 0,
      };
      if (result.ok) {
        album.count += 1;
        summary.uploaded += 1;
      } else {
        summary.failed += 1;
        summary.errors.push({ photoId: result.photoId, message: result.error ?? 'unknown' });
      }
      album.productUrl = album.productUrl || result.albumUrl;
      albumCounts.set(result.albumKey, album);
    }

    for (const [key, album] of albumCounts.entries()) {
      summary.albums.push({
        key,
        title: album.title,
        productUrl: album.productUrl,
        count: album.count,
      });
    }

    return NextResponse.json(summary);
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/google-photos/backup');
  }
}, { permission: 'admin.view' });
