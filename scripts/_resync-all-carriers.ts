/**
 * One-off bulk re-sync of all alive shipments across UPS / USPS / FedEx.
 *
 * Why this exists: production cron has been failing 401 against the carrier
 * APIs (see shipping_tracking_numbers.last_error_message) for a while. After
 * the auth-hardening pass to providers/{ups,usps,fedex}.ts (in-flight token
 * dedup + 401 retry), we still need to actually re-sync the backlog of rows
 * whose carrier state in DB is stale. Run locally where .env credentials
 * have been verified to work.
 *
 * Usage:
 *   npx tsx scripts/_resync-all-carriers.ts                  # all carriers
 *   npx tsx scripts/_resync-all-carriers.ts FEDEX            # one carrier
 *   npx tsx scripts/_resync-all-carriers.ts FEDEX UPS        # subset
 *
 * Concurrency is per-carrier; we don't fan out across carriers in parallel
 * to keep error attribution clean. Each carrier processes in batches of 5.
 */

import 'dotenv/config';
import { syncShipment } from '../src/lib/shipping/sync-shipment';
import pool from '../src/lib/db';

const CARRIERS = ['UPS', 'USPS', 'FEDEX'] as const;
type Carrier = (typeof CARRIERS)[number];

const BATCH_SIZE = 5;

async function getAliveShipmentIds(carrier: Carrier): Promise<number[]> {
  const r = await pool.query<{ id: number }>(
    `SELECT id
       FROM shipping_tracking_numbers
      WHERE carrier = $1
        AND is_terminal = false
      ORDER BY
        CASE WHEN is_out_for_delivery THEN 0
             WHEN is_in_transit       THEN 1
             WHEN is_carrier_accepted THEN 2
             ELSE 3 END,
        consecutive_error_count DESC,
        next_check_at ASC NULLS FIRST`,
    [carrier],
  );
  return r.rows.map((row) => Number(row.id));
}

async function runOne(shipmentId: number) {
  try {
    const r = await syncShipment({ shipmentId });
    return r;
  } catch (e: any) {
    return { ok: false, shipmentId, error: String(e?.message ?? e), errorCode: 'THROW' };
  }
}

async function runCarrier(carrier: Carrier) {
  const ids = await getAliveShipmentIds(carrier);
  console.log(`\n=== ${carrier}: ${ids.length} alive shipment(s) ===`);

  let okCount = 0;
  let delivered = 0;
  let exceptions = 0;
  let errCount = 0;
  const errorBuckets = new Map<string, number>();

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(runOne));
    for (const r of results) {
      if (r.ok) {
        okCount++;
        if (r.status === 'DELIVERED' || r.status === 'RETURNED') delivered++;
        if (r.status === 'EXCEPTION') exceptions++;
      } else {
        errCount++;
        const key = r.errorCode || 'UNKNOWN';
        errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
      }
    }
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= ids.length) {
      process.stdout.write(`  progress ${Math.min(i + BATCH_SIZE, ids.length)}/${ids.length}  ok=${okCount}  err=${errCount}\r`);
    }
  }

  console.log(`\n  done: ok=${okCount} (delivered=${delivered}, exception=${exceptions})  errors=${errCount}`);
  if (errorBuckets.size > 0) {
    console.log('  error breakdown:');
    for (const [code, n] of [...errorBuckets.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code}: ${n}`);
    }
  }
}

async function main() {
  const requested = process.argv.slice(2).map((s) => s.toUpperCase()) as Carrier[];
  const targets = requested.length > 0
    ? CARRIERS.filter((c) => requested.includes(c))
    : [...CARRIERS];

  if (targets.length === 0) {
    console.error('No valid carriers requested. Choose from:', CARRIERS.join(', '));
    process.exit(1);
  }

  console.log(`Bulk re-sync targets: ${targets.join(', ')}`);
  const t0 = Date.now();
  for (const c of targets) {
    await runCarrier(c);
  }
  console.log(`\nTotal elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
