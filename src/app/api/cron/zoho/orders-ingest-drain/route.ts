/**
 * GET /api/cron/zoho/orders-ingest-drain  (Vercel cron, every minute)
 *
 * Drains order_ingest_queue — the DB outbox that replaced the QStash event
 * queue for external order ingest. Claims a batch of pending rows
 * (FOR UPDATE SKIP LOCKED via an atomic UPDATE…RETURNING), ingests each via
 * orderSyncService, and marks it done/failed.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { orderSyncService, type ChannelOrder } from '@/services/OrderSyncService';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH = 25;
const MAX_ATTEMPTS = 5;

interface QueueRow {
  id: number;
  channel_order_id: string;
  organization_id: string | null;
  payload: ChannelOrder;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await withCronRun('zoho.orders_ingest_drain', async () => {
      // Atomically claim a batch so concurrent runs never grab the same rows.
      const { rows } = await pool.query<QueueRow>(
        `UPDATE order_ingest_queue
            SET status = 'processing'
          WHERE id IN (
            SELECT id FROM order_ingest_queue
             WHERE status = 'pending'
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
        RETURNING id, channel_order_id, organization_id, payload`,
        [BATCH],
      );

      let done = 0;
      let failed = 0;
      for (const row of rows) {
        const orgId = row.organization_id ?? transitionalUsavOrgId();
        try {
          await orderSyncService.ingestExternalOrder(orgId, row.payload);
          await pool.query(
            `UPDATE order_ingest_queue
                SET status = 'done', processed_at = NOW(), last_error = NULL
              WHERE id = $1`,
            [row.id],
          );
          done++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'ingest failed';
          // Exhausted attempts stay 'failed'; otherwise back to 'pending' for retry.
          await pool.query(
            `UPDATE order_ingest_queue
                SET attempts = attempts + 1,
                    last_error = $2,
                    status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
                    processed_at = NOW()
              WHERE id = $1`,
            [row.id, message.slice(0, 1000), MAX_ATTEMPTS],
          );
          failed++;
        }
      }

      return { claimed: rows.length, done, failed };
    });

    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'drain failed';
    console.error('[cron.zoho.orders-ingest-drain] fatal', { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
