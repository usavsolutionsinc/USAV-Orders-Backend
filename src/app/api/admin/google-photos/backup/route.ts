import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { getOrCreateAlbum, uploadAndAttach } from '@/lib/google-photos/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface PendingPhoto {
  id: number;
  entity_type: string;
  entity_id: number;
  url: string;
  created_at: string;
  receiving_tracking_number: string | null;
  packer_scan_ref: string | null;
}

interface BackupSummary {
  date: string;
  scanned: number;
  uploaded: number;
  skipped: number;
  failed: number;
  albums: Array<{ key: string; title: string; productUrl?: string; count: number }>;
  errors: Array<{ photoId: number; message: string }>;
}

function stationFor(entityType: string): string {
  if (entityType === 'RECEIVING') return 'Receiving';
  if (entityType === 'PACKER_LOG') return 'Packing';
  return entityType;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function localDateBounds(dateStr: string): { startUtc: string; endUtc: string } {
  // Treat YYYY-MM-DD as a calendar day in UTC. Good enough for grouping;
  // we don't need timezone precision for a daily backup album.
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(start.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

function yesterdayUtc(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function safeRef(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
}

function filenameFor(photo: PendingPhoto, station: string): string {
  const ref =
    photo.entity_type === 'RECEIVING'
      ? photo.receiving_tracking_number
      : photo.packer_scan_ref;
  const refPart = safeRef(ref) || `${photo.entity_type}-${photo.entity_id}`;
  const ts = new Date(photo.created_at);
  const tsPart = `${ts.getUTCFullYear()}-${pad2(ts.getUTCMonth() + 1)}-${pad2(ts.getUTCDate())}_${pad2(ts.getUTCHours())}${pad2(ts.getUTCMinutes())}${pad2(ts.getUTCSeconds())}`;
  return `${station}_${refPart}_${tsPart}.jpg`;
}

function descriptionFor(photo: PendingPhoto, station: string): string {
  const ref =
    photo.entity_type === 'RECEIVING'
      ? photo.receiving_tracking_number
      : photo.packer_scan_ref;
  const refLabel = photo.entity_type === 'RECEIVING' ? 'Tracking' : 'Order/Scan';
  const parts = [
    `Station: ${station}`,
    `${refLabel}: ${ref ?? 'n/a'}`,
    `Source: ${photo.entity_type} #${photo.entity_id}`,
    `Captured: ${photo.created_at}`,
  ];
  return parts.join(' · ');
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const date: string = (body?.date as string) || yesterdayUtc();
    const limit: number = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
    const { startUtc, endUtc } = localDateBounds(date);

    const { rows } = await pool.query<PendingPhoto>(
      `SELECT p.id,
              p.entity_type,
              p.entity_id,
              p.url,
              p.created_at,
              r.receiving_tracking_number,
              pl.scan_ref AS packer_scan_ref
       FROM photos p
       LEFT JOIN receiving   r  ON p.entity_type = 'RECEIVING'  AND r.id  = p.entity_id
       LEFT JOIN packer_logs pl ON p.entity_type = 'PACKER_LOG' AND pl.id = p.entity_id
       WHERE p.google_photos_id IS NULL
         AND p.created_at >= $1
         AND p.created_at <  $2
       ORDER BY p.created_at ASC
       LIMIT $3`,
      [startUtc, endUtc, limit],
    );

    const summary: BackupSummary = {
      date,
      scanned: rows.length,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      albums: [],
      errors: [],
    };

    if (rows.length === 0) {
      return NextResponse.json(summary);
    }

    const albumCache = new Map<string, { id: string; title: string; productUrl?: string; count: number }>();

    for (const photo of rows) {
      const station = stationFor(photo.entity_type);
      const albumKey = `${date}__${station.toLowerCase()}`;
      const albumTitle = `${date} · ${station}`;

      try {
        let album = albumCache.get(albumKey);
        if (!album) {
          const created = await getOrCreateAlbum(albumKey, albumTitle);
          album = { id: created.id, title: created.title, productUrl: created.productUrl, count: 0 };
          albumCache.set(albumKey, album);
        }

        const blobRes = await fetch(photo.url);
        if (!blobRes.ok) {
          throw new Error(`Failed to fetch from Vercel Blob (${blobRes.status})`);
        }
        const arrayBuf = await blobRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const filename = filenameFor(photo, station);
        const description = descriptionFor(photo, station);

        const media = await uploadAndAttach({
          buffer,
          filename,
          description,
          albumId: album.id,
          mimeType: 'image/jpeg',
        });

        await pool.query(
          `UPDATE photos
             SET google_photos_id      = $1,
                 google_product_url    = $2,
                 google_album_id       = $3,
                 google_filename       = $4,
                 uploaded_to_google_at = NOW()
           WHERE id = $5`,
          [media.id, media.productUrl, album.id, media.filename, photo.id],
        );

        album.count += 1;
        summary.uploaded += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          photoId: photo.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const [key, album] of albumCache.entries()) {
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
