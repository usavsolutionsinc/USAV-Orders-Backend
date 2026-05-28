#!/usr/bin/env tsx
/**
 * Force-refresh non-terminal FedEx shipments via the production
 * `syncShipment` helper. Bypasses the cron `next_check_at` schedule.
 *
 * Reuses the production code path so any FedEx response-shape edge cases
 * (status text fallback, deduped events, etc.) match steady-state behavior.
 *
 * Usage:
 *   npx tsx scripts/refresh-fedex-shipments.ts           # dry run
 *   npx tsx scripts/refresh-fedex-shipments.ts --apply   # actually re-poll
 *   npx tsx scripts/refresh-fedex-shipments.ts --apply --limit 50
 */

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

import { Pool } from 'pg';
import { syncShipment } from '../src/lib/shipping/sync-shipment';

const APPLY = process.argv.includes('--apply');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX > 0 ? Number(process.argv[LIMIT_IDX + 1]) : 100;
const CONCURRENCY = 4;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

interface DueRow {
  id: number;
  tracking_number_normalized: string;
  latest_status_category: string | null;
}

async function main() {
  console.log(APPLY ? `APPLY — re-polling up to ${LIMIT} FedEx shipments (concurrency=${CONCURRENCY})` : 'DRY RUN');

  const due = await pool.query<DueRow>(`
    SELECT id, tracking_number_normalized, latest_status_category
      FROM shipping_tracking_numbers
     WHERE carrier = 'FEDEX'
       AND is_terminal = false
       AND (latest_status_category IS NULL
            OR latest_status_category IN ('UNKNOWN','LABEL_CREATED','ACCEPTED','IN_TRANSIT','OUT_FOR_DELIVERY','EXCEPTION'))
     ORDER BY COALESCE(last_checked_at, '1970-01-01'::timestamptz) ASC
     LIMIT $1
  `, [LIMIT]);

  console.log(`targets: ${due.rows.length}`);
  if (!APPLY) {
    due.rows.slice(0, 5).forEach((r) => console.log(' ', r));
    if (due.rows.length > 5) console.log(`  …and ${due.rows.length - 5} more.`);
    await pool.end();
    return;
  }

  let synced = 0, delivered = 0, errors = 0;
  for (let i = 0; i < due.rows.length; i += CONCURRENCY) {
    const chunk = due.rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((row) => syncShipment({ shipmentId: row.id })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        synced++;
        if (r.value.status === 'DELIVERED') delivered++;
      } else {
        errors++;
        if (r.status === 'fulfilled') {
          console.warn(`  ${r.value.error || r.value.errorCode || 'sync failed'}`);
        }
      }
    }
  }

  console.log(`done — synced: ${synced}, newly delivered: ${delivered}, errors: ${errors}`);
  await pool.end();
}

main().catch((err) => {
  console.error('refresh failed:', err);
  process.exit(1);
});
