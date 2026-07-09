#!/usr/bin/env tsx
/**
 * report-packing-today.ts — downloadable per-packer packing KPI CSV (PST day).
 *
 * Uses the same query path as GET /api/packing/kpi (src/lib/packing/packer-kpi-queries.ts).
 * Tier/minutes come from packer_log_enrichment (profile → CLEAN metadata → rules).
 *
 * Usage:
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid>
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --date=2026-07-08
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --out=reports/packing-2026-07-08.csv
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --backfill   # recompute enrichment for today's PACK scans first
 */

import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { getPackingKpisForDay, packerKpiSummaryToCsv } from '../src/lib/packing/packer-kpi-queries';
import { getCurrentPSTDateKey } from '../src/utils/date';
import { computePackerLogEnrichment } from '../src/lib/neon/packer-log-enrichment';
import type { OrgId } from '../src/lib/tenancy/constants';

loadEnv({ path: path.resolve('.env'), quiet: true });
loadEnv({ path: path.resolve('.env.local'), override: false, quiet: true });

const args = process.argv.slice(2);
const orgIdArg = args.find((a) => a.startsWith('--orgId='));
const dateArg = args.find((a) => a.startsWith('--date='));
const outArg = args.find((a) => a.startsWith('--out='));
const BACKFILL = args.includes('--backfill');

const ORG_ID = orgIdArg ? orgIdArg.slice('--orgId='.length).trim() : '';
const DAY = dateArg ? dateArg.slice('--date='.length).trim() : getCurrentPSTDateKey();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultOutPath(orgId: string, day: string): string {
  const shortOrg = orgId.slice(0, 8);
  return path.resolve(`reports/packing-${day}-${shortOrg}.csv`);
}

async function backfillTodayEnrichment(pool: pg.Pool, orgId: string, day: string): Promise<number> {
  const found = await pool.query<{ id: number }>(
    `SELECT sal.id
       FROM station_activity_logs sal
      WHERE sal.station = 'PACK'
        AND sal.activity_type = 'PACK_COMPLETED'
        AND sal.organization_id = $1
        AND (timezone('America/Los_Angeles', sal.created_at))::date = $2::date
      ORDER BY sal.created_at DESC`,
    [orgId, day],
  );
  const ids = found.rows.map((r) => r.id);
  if (ids.length === 0) return 0;

  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    await computePackerLogEnrichment(pool, ids.slice(i, i + BATCH));
  }
  return ids.length;
}

async function main() {
  if (!ORG_ID || !UUID_RE.test(ORG_ID)) {
    console.error('Missing or invalid --orgId=<uuid> (required).');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
    options: '-c timezone=America/Los_Angeles',
  });

  try {
    if (BACKFILL) {
      const n = await backfillTodayEnrichment(pool, ORG_ID, DAY);
      console.log(`Backfilled packer_log_enrichment for ${n} PACK scan(s) on ${DAY}.`);
    }

    const summary = await getPackingKpisForDay(ORG_ID as OrgId, DAY);
    const csv = packerKpiSummaryToCsv(summary);
    const outPath = outArg ? path.resolve(outArg.slice('--out='.length)) : defaultOutPath(ORG_ID, DAY);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, csv, 'utf8');

    console.log(`Packing KPI report written: ${outPath}`);
    console.log(`  Day (PST):     ${summary.day}`);
    console.log(`  Packers:       ${summary.by_packer.length}`);
    console.log(`  Totals:        small=${summary.totals.small_count} medium=${summary.totals.medium_count} large=${summary.totals.large_count}`);
    console.log(`  Weighted min:  ${summary.totals.weighted_minutes} / ${summary.capacity.daily_capacity_minutes} team capacity`);
    console.log(`  Workday min:   ${summary.capacity.workday_minutes} per packer (% of day denominator)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
