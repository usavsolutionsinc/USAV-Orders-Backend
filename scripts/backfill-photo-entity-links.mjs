#!/usr/bin/env node
/**
 * Backfill photo_entity_links from legacy photos.entity_type / entity_id.
 * Idempotent — safe to re-run (ON CONFLICT DO NOTHING).
 *
 *   node scripts/backfill-photo-entity-links.mjs
 *   node scripts/backfill-photo-entity-links.mjs --dry
 */
import pg from 'pg';

const dry = process.argv.includes('--dry');
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('DATABASE_URL or POSTGRES_URL required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

const sql = `
INSERT INTO photo_entity_links (photo_id, organization_id, entity_type, entity_id, link_role)
SELECT p.id, p.organization_id, p.entity_type, p.entity_id, 'primary'
FROM photos p
WHERE p.entity_type IS NOT NULL
  AND p.entity_id IS NOT NULL
  AND p.organization_id IS NOT NULL
ON CONFLICT DO NOTHING;
`;

try {
  if (dry) {
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM photos p
        WHERE p.entity_type IS NOT NULL AND p.entity_id IS NOT NULL AND p.organization_id IS NOT NULL`,
    );
    console.log(`[dry] would backfill up to ${count.rows[0].n} link rows`);
  } else {
    const res = await pool.query(sql);
    console.log(`Backfilled photo_entity_links (${res.rowCount ?? 0} rows inserted this run)`);
  }
} finally {
  await pool.end();
}
