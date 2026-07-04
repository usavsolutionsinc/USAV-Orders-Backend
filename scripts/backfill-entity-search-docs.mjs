#!/usr/bin/env node
/**
 * Backfill entity_search_docs by ENQUEUEING every P0 entity row into
 * entity_search_outbox — the worker (cron /api/cron/search-outbox) stays the
 * single path that builds search_text and embeds. This script never embeds
 * or writes docs inline (locked decision 5: trigger → outbox → worker).
 *
 * Idempotent: inserts land on the pending partial unique
 * (organization_id, entity_type, entity_id) WHERE processed_at IS NULL
 * with ON CONFLICT DO NOTHING, so re-running (or racing live triggers)
 * cannot double-enqueue.
 *
 * Usage:
 *   node scripts/backfill-entity-search-docs.mjs                 # all orgs
 *   node scripts/backfill-entity-search-docs.mjs --org=<uuid>    # one org
 *   node scripts/backfill-entity-search-docs.mjs --entity=SKU    # one entity type
 *
 * Run AFTER migration 2026-07-03d is applied. Requires DATABASE_URL (owner —
 * the enqueue spans orgs; org scoping is carried on every inserted row).
 *
 * COST NOTE (initial full backfill): the worker embeds + HNSW-inserts each
 * doc incrementally, which is materially pricier per row than a bulk index
 * build. For a large first load, either let it drain slowly at the cron
 * cadence (batch 50 × 10 every 5 min ≈ 6k rows/hr — fine), or for a big
 * catalog drop idx_entity_search_docs_embedding_hnsw first and recreate it
 * after the queue drains. Steady-state (post-backfill) volume is trivial.
 */

import { Pool } from 'pg';

const SOURCES = {
  ORDER: 'SELECT organization_id, id FROM orders WHERE organization_id IS NOT NULL',
  SERIAL_UNIT: 'SELECT organization_id, id FROM serial_units WHERE organization_id IS NOT NULL',
  RECEIVING: 'SELECT organization_id, id FROM receiving WHERE organization_id IS NOT NULL',
  SKU: 'SELECT organization_id, id FROM sku_catalog WHERE organization_id IS NOT NULL',
  REPAIR: 'SELECT organization_id, id FROM repair_service WHERE organization_id IS NOT NULL',
  FBA_SHIPMENT: 'SELECT organization_id, id FROM fba_shipments WHERE organization_id IS NOT NULL',
};

async function main() {
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

  const orgArg = process.argv.find((a) => a.startsWith('--org='));
  const org = orgArg ? orgArg.split('=')[1] : null;
  const entityArg = process.argv.find((a) => a.startsWith('--entity='));
  const onlyEntity = entityArg ? entityArg.split('=')[1].toUpperCase() : null;

  if (onlyEntity && !SOURCES[onlyEntity]) {
    console.error(`Unknown --entity=${onlyEntity}. One of: ${Object.keys(SOURCES).join(', ')}`);
    process.exit(2);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const entities = onlyEntity ? [onlyEntity] : Object.keys(SOURCES);
    let total = 0;

    for (const entityType of entities) {
      const source = SOURCES[entityType];
      const params = [entityType];
      let where = '';
      if (org) {
        params.push(org);
        where = ' AND organization_id = $2';
      }
      const res = await pool.query(
        `INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
         SELECT organization_id, $1, id FROM (${source}${where}) src
         ON CONFLICT (organization_id, entity_type, entity_id)
         WHERE processed_at IS NULL AND claimed_at IS NULL
         DO NOTHING`,
        params,
      );
      console.log(`${entityType}: enqueued ${res.rowCount} rows${org ? ` (org ${org})` : ''}`);
      total += res.rowCount ?? 0;
    }

    const pending = await pool.query(
      'SELECT COUNT(*)::int AS n FROM entity_search_outbox WHERE processed_at IS NULL',
    );
    console.log(`Done. Enqueued ${total} new rows; ${pending.rows[0].n} pending total.`);
    console.log('Next: let the /api/cron/search-outbox worker drain (or curl it with CRON_SECRET).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
