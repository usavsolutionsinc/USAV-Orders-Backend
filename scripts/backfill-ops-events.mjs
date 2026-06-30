#!/usr/bin/env node
/**
 * Backfill ops_events from legacy receiving audit sources:
 *   - receiving_scans → TRACKING_SCANNED (one per scan row)
 *   - receiving.unboxed_at → UNBOX_CONFIRMED (one per receiving row)
 *
 * Idempotent via client_event_id.
 *
 * Defaults to the last 7 days only (fast). Override with:
 *   --days=14
 *
 * Usage:
 *   node scripts/backfill-ops-events.mjs
 */

import { Pool } from 'pg';

async function main() {
  // Load .env when present so the script works outside Next.js.
  try {
    const { config } = await import('dotenv');
    config({ path: '.env.local' });
    config({ path: '.env' });
  } catch {
    // dotenv optional
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(2);
  }

  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const daysRaw = daysArg ? Number(daysArg.split('=')[1]) : 7;
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 7;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Ensure table exists (migration should have run, but this keeps the script
  // friendlier in dev environments).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_events (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
      occurred_at      timestamptz NOT NULL DEFAULT now(),
      event_type       text NOT NULL,
      entity_type      text NOT NULL,
      entity_id        bigint NOT NULL,
      actor_staff_id   integer REFERENCES staff(id) ON DELETE SET NULL,
      client_event_id  text UNIQUE,
      payload          jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  // 1) receiving_scans → TRACKING_SCANNED (last N days)
  const scanRes = await pool.query(
    `
    SELECT
      rs.id,
      rs.receiving_id,
      rs.tracking_number,
      rs.carrier,
      rs.scanned_at,
      rs.scanned_by,
      r.organization_id
    FROM receiving_scans rs
    JOIN receiving r ON r.id = rs.receiving_id
    WHERE r.organization_id IS NOT NULL
      AND rs.scanned_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY rs.id ASC
  `,
    [days],
  );

  let scansInserted = 0;
  for (const row of scanRes.rows) {
    const clientEventId = `backfill:receiving_scan:${row.id}`;
    const r = await pool.query(
      `INSERT INTO ops_events (
         organization_id, occurred_at, event_type,
         entity_type, entity_id,
         actor_staff_id, client_event_id, payload
       )
       VALUES ($1, $2, 'TRACKING_SCANNED', 'receiving', $3, $4, $5, $6::jsonb)
       ON CONFLICT (client_event_id) DO NOTHING`,
      [
        row.organization_id,
        row.scanned_at,
        row.receiving_id,
        row.scanned_by,
        clientEventId,
        JSON.stringify({
          receivingId: row.receiving_id,
          scanId: row.id,
          trackingNumber: row.tracking_number,
          carrier: row.carrier,
        }),
      ],
    );
    scansInserted += r.rowCount ?? 0;
  }

  // 2) receiving.unboxed_at → UNBOX_CONFIRMED (last N days)
  const unboxRes = await pool.query(
    `
    SELECT
      r.id AS receiving_id,
      r.organization_id,
      r.unboxed_at,
      r.unboxed_by
    FROM receiving r
    WHERE r.unboxed_at IS NOT NULL
      AND r.organization_id IS NOT NULL
      AND r.unboxed_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY r.id ASC
  `,
    [days],
  );

  let unboxedInserted = 0;
  for (const row of unboxRes.rows) {
    const clientEventId = `backfill:receiving_unbox:${row.receiving_id}`;
    const r = await pool.query(
      `INSERT INTO ops_events (
         organization_id, occurred_at, event_type,
         entity_type, entity_id,
         actor_staff_id, client_event_id, payload
       )
       VALUES ($1, $2, 'UNBOX_CONFIRMED', 'receiving', $3, $4, $5, $6::jsonb)
       ON CONFLICT (client_event_id) DO NOTHING`,
      [
        row.organization_id,
        row.unboxed_at,
        row.receiving_id,
        row.unboxed_by,
        clientEventId,
        JSON.stringify({ receivingId: row.receiving_id }),
      ],
    );
    unboxedInserted += r.rowCount ?? 0;
  }

  console.log(`backfill complete (days=${days}): TRACKING_SCANNED inserted=${scansInserted}, UNBOX_CONFIRMED inserted=${unboxedInserted}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

