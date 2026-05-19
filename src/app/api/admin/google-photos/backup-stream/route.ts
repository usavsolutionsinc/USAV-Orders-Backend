import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import type { AlbumResult } from '@/lib/google-photos/client';
import {
  processPhoto,
  queryPendingPhotos,
  yesterdayUtc,
} from '@/lib/google-photos/backup';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type StreamEvent =
  | { type: 'start'; date: string; total: number }
  | {
      type: 'progress';
      photoId: number;
      index: number;
      total: number;
      station: string;
      ok: boolean;
      filename?: string;
      albumTitle: string;
      albumUrl?: string;
      error?: string;
    }
  | { type: 'done'; uploaded: number; failed: number; aborted: boolean }
  | { type: 'error'; message: string };

function sseChunk(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || yesterdayUtc();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const idsParam = url.searchParams.get('ids');
  const ids = idsParam
    ? idsParam
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  // Record a run row up front so even an aborted/crashed run leaves an audit trail.
  const runInsert = await pool.query<{ id: number }>(
    `INSERT INTO google_photos_backup_runs (source, date, triggered_by_staff_id)
     VALUES ('manual_stream', $1, $2) RETURNING id`,
    [date, ctx.staffId],
  );
  const runId = runInsert.rows[0].id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      const send = (ev: StreamEvent) => {
        if (closed) return;
        try { controller.enqueue(sseChunk(ev)); } catch { closed = true; }
      };

      // Keep-alive comment every 15s so proxies don't kill the connection.
      const keepAlive = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(new TextEncoder().encode(`: ping\n\n`)); } catch { closed = true; }
      }, 15_000);

      // Client disconnect / cancel.
      const onAbort = () => {
        closed = true;
        clearInterval(keepAlive);
        try { controller.close(); } catch { /* */ }
      };
      req.signal.addEventListener('abort', onAbort);

      let scanned = 0;
      let uploaded = 0;
      let failed = 0;
      const errors: Array<{ photoId: number; message: string }> = [];

      try {
        const photos = await queryPendingPhotos({ date, limit, ids });
        scanned = photos.length;
        send({ type: 'start', date, total: photos.length });

        const albumCache = new Map<string, AlbumResult>();
        let index = 0;

        for (const photo of photos) {
          if (req.signal.aborted) break;
          index += 1;
          const result = await processPhoto(photo, date, albumCache);
          if (result.ok) {
            uploaded += 1;
          } else {
            failed += 1;
            errors.push({ photoId: result.photoId, message: result.error ?? 'unknown' });
          }
          send({
            type: 'progress',
            photoId: result.photoId,
            index,
            total: photos.length,
            station: result.station,
            ok: result.ok,
            filename: result.filename,
            albumTitle: result.albumTitle,
            albumUrl: result.albumUrl,
            error: result.error,
          });
        }

        send({ type: 'done', uploaded, failed, aborted: req.signal.aborted });

        await recordAudit(pool, ctx, req, {
          source: 'admin.photo_backup',
          action: 'google_photos.backup_run',
          entityType: 'google_photos',
          entityId: `run:${runId}`,
          method: 'manual',
          extra: {
            date,
            scanned,
            uploaded,
            failed,
            aborted: req.signal.aborted,
            via: 'stream',
          },
        });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          await pool.query(
            `UPDATE google_photos_backup_runs
               SET ended_at = NOW(),
                   scanned = $1,
                   uploaded = $2,
                   failed = $3,
                   error_summary = $4
             WHERE id = $5`,
            [
              scanned,
              uploaded,
              failed,
              errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
              runId,
            ],
          );
        } catch {
          // best-effort: don't crash the stream finalizer if the row is gone
        }
        clearInterval(keepAlive);
        req.signal.removeEventListener('abort', onAbort);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}, { permission: 'admin.view' });
