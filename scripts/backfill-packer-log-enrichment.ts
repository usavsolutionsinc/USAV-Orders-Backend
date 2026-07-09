#!/usr/bin/env tsx
/**
 * backfill-packer-log-enrichment.ts — populate the shipped-table read model.
 *
 * WHY: /api/packerlogs can read precomputed enrichments from
 * `packer_log_enrichment` (created by 2026-06-29f) instead of re-running ~6
 * non-indexable LATERALs per row, BUT only once those rows exist. New PACK scans
 * self-populate (POST /api/packerlogs); this backfills the HISTORY so the
 * PACKER_LOG_ENRICHMENT_READ flag can be flipped without blank titles on old
 * rows.
 *
 * Reuses the exact compute path (src/lib/neon/packer-log-enrichment.ts) so the
 * projected values are identical to the inline laterals — no SQL is duplicated
 * here. UPSERT-based, so it is fully idempotent and re-runnable; re-running also
 * serves as a catch-up for any linkage drift.
 *
 * Processes newest-first (recent weeks are what users actually view) in batches.
 * By default only fills MISSING rows; --stale recomputes existing ones too.
 *
 *   npx tsx scripts/backfill-packer-log-enrichment.ts                # DRY RUN
 *   npx tsx scripts/backfill-packer-log-enrichment.ts --apply        # all history
 *   npx tsx scripts/backfill-packer-log-enrichment.ts --apply --since=2026-01-01
 *   npx tsx scripts/backfill-packer-log-enrichment.ts --apply --org=<uuid>
 *   npx tsx scripts/backfill-packer-log-enrichment.ts --apply --stale   # recompute all
 */

import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { computePackerLogEnrichment } from '../src/lib/neon/packer-log-enrichment';

loadEnv({ path: path.resolve('.env'), quiet: true });
loadEnv({ path: path.resolve('.env.local'), override: false, quiet: true });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STALE = args.includes('--stale');
const orgArg = args.find((a) => a.startsWith('--org='));
const ONLY_ORG = orgArg ? orgArg.slice('--org='.length) : null;
const sinceArg = args.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? sinceArg.slice('--since='.length) : null;
const batchArg = args.find((a) => a.startsWith('--batch='));
const BATCH = batchArg ? Math.max(1, parseInt(batchArg.slice('--batch='.length), 10) || 500) : 500;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
});

/** Candidate PACK sal ids, newest-first. Missing-only unless --stale. */
function findSql(): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = [`sal.station = 'PACK'`];
  if (!STALE) where.push(`enr.sal_id IS NULL`);
  if (ONLY_ORG) {
    params.push(ONLY_ORG);
    where.push(`sal.organization_id = $${params.length}`);
  }
  if (SINCE) {
    params.push(SINCE);
    where.push(`sal.created_at >= $${params.length}::date`);
  }
  const sql = `
    SELECT sal.id
      FROM station_activity_logs sal
      LEFT JOIN packer_log_enrichment enr ON enr.sal_id = sal.id
     WHERE ${where.join(' AND ')}
     ORDER BY sal.created_at DESC NULLS LAST`;
  return { sql, params };
}

async function main() {
  const { sql, params } = findSql();
  const found = await pool.query(sql, params);
  const ids: number[] = found.rows.map((r: { id: number }) => r.id);

  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_ORG ? ` (org=${ONLY_ORG})` : ' (all orgs)'}` +
    `${SINCE ? ` since=${SINCE}` : ''}${STALE ? ' [stale: recompute existing]' : ' [missing only]'}`);
  console.log(`PACK scans to (re)compute: ${ids.length}  (batch=${BATCH})`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.\n');
    await pool.end();
    return;
  }

  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    await computePackerLogEnrichment(pool, slice);
    done += slice.length;
    console.log(`  …${done}/${ids.length}`);
  }

  console.log(`\nEnriched ${done} PACK scans into packer_log_enrichment.`);
  console.log(`Reverse with: DELETE FROM packer_log_enrichment;  (then re-run to rebuild)\n`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
