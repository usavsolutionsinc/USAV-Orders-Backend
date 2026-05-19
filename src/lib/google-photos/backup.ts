import pool from '@/lib/db';
import { getOrCreateAlbum, uploadAndAttach, type AlbumResult } from './client';

export interface PendingPhoto {
  id: number;
  entity_type: string;
  entity_id: number;
  url: string;
  created_at: string;
  receiving_tracking_number: string | null;
  packer_scan_ref: string | null;
}

export interface PhotoProcessResult {
  photoId: number;
  station: string;
  ok: boolean;
  filename?: string;
  albumKey: string;
  albumTitle: string;
  albumId?: string;
  albumUrl?: string;
  error?: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function safeRef(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
}

export function stationFor(entityType: string): string {
  if (entityType === 'RECEIVING') return 'Receiving';
  if (entityType === 'PACKER_LOG') return 'Packing';
  return entityType;
}

export function yesterdayUtc(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function localDateBounds(dateStr: string): { startUtc: string; endUtc: string } {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(start.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function filenameFor(photo: PendingPhoto, station: string): string {
  const ref =
    photo.entity_type === 'RECEIVING' ? photo.receiving_tracking_number : photo.packer_scan_ref;
  const refPart = safeRef(ref) || `${photo.entity_type}-${photo.entity_id}`;
  const ts = new Date(photo.created_at);
  const tsPart = `${ts.getUTCFullYear()}-${pad2(ts.getUTCMonth() + 1)}-${pad2(ts.getUTCDate())}_${pad2(ts.getUTCHours())}${pad2(ts.getUTCMinutes())}${pad2(ts.getUTCSeconds())}`;
  return `${station}_${refPart}_${tsPart}.jpg`;
}

export function descriptionFor(photo: PendingPhoto, station: string): string {
  const ref =
    photo.entity_type === 'RECEIVING' ? photo.receiving_tracking_number : photo.packer_scan_ref;
  const refLabel = photo.entity_type === 'RECEIVING' ? 'Tracking' : 'Order/Scan';
  return [
    `Station: ${station}`,
    `${refLabel}: ${ref ?? 'n/a'}`,
    `Source: ${photo.entity_type} #${photo.entity_id}`,
    `Captured: ${photo.created_at}`,
  ].join(' · ');
}

export async function queryPendingPhotos(params: {
  date: string;
  limit: number;
  ids?: number[];
}): Promise<PendingPhoto[]> {
  const { startUtc, endUtc } = localDateBounds(params.date);
  const sqlParts: string[] = [
    `p.google_photos_id IS NULL`,
    `p.created_at >= $1`,
    `p.created_at <  $2`,
  ];
  const vals: unknown[] = [startUtc, endUtc];
  if (params.ids && params.ids.length > 0) {
    sqlParts.push(`p.id = ANY($3::bigint[])`);
    vals.push(params.ids);
  }
  vals.push(params.limit);
  const limitIdx = vals.length;

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
     WHERE ${sqlParts.join(' AND ')}
     ORDER BY p.created_at ASC
     LIMIT $${limitIdx}`,
    vals,
  );
  return rows;
}

export async function processPhoto(
  photo: PendingPhoto,
  date: string,
  albumCache: Map<string, AlbumResult>,
): Promise<PhotoProcessResult> {
  const station = stationFor(photo.entity_type);
  const albumKey = `${date}__${station.toLowerCase()}`;
  const albumTitle = `${date} · ${station}`;
  const baseResult: Omit<PhotoProcessResult, 'ok'> = {
    photoId: photo.id,
    station,
    albumKey,
    albumTitle,
  };

  try {
    let album = albumCache.get(albumKey);
    if (!album) {
      album = await getOrCreateAlbum(albumKey, albumTitle);
      albumCache.set(albumKey, album);
    }

    const blobRes = await fetch(photo.url);
    if (!blobRes.ok) {
      throw new Error(`Failed to fetch from Vercel Blob (${blobRes.status})`);
    }
    const buffer = Buffer.from(await blobRes.arrayBuffer());

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

    return {
      ...baseResult,
      ok: true,
      filename: media.filename,
      albumId: album.id,
      albumUrl: album.productUrl,
    };
  } catch (err) {
    return {
      ...baseResult,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
