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
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --out=reports/packing-2026-07-08.rtf
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --format=txt --out=report.txt
 *   npx tsx scripts/report-packing-today.ts --orgId=<uuid> --days=10 --out=reports/packing-last-10-days.rtf
 */

import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import {
  getPackingKpisForDay,
  getPackingKpisForLastFilledDays,
  listRecentFilledPackDays,
  packerKpiSummaryToCsv,
} from '../src/lib/packing/packer-kpi-queries';
import {
  inferDocumentFormatFromPath,
  packerKpiPeriodToDocument,
  packerKpiSummaryToDocument,
} from '../src/lib/packing/packing-report-document';
import { getCurrentPSTDateKey } from '../src/utils/date';
import { computePackerLogEnrichment } from '../src/lib/neon/packer-log-enrichment';
import type { OrgId } from '../src/lib/tenancy/constants';

loadEnv({ path: path.resolve('.env'), quiet: true });
loadEnv({ path: path.resolve('.env.local'), override: false, quiet: true });

const args = process.argv.slice(2);
const orgIdArg = args.find((a) => a.startsWith('--orgId='));
const dateArg = args.find((a) => a.startsWith('--date='));
const outArg = args.find((a) => a.startsWith('--out='));
const formatArg = args.find((a) => a.startsWith('--format='));
const daysArg = args.find((a) => a.startsWith('--days='));
const BACKFILL = args.includes('--backfill');

const ORG_ID = orgIdArg ? orgIdArg.slice('--orgId='.length).trim() : '';
const DAY = dateArg ? dateArg.slice('--date='.length).trim() : getCurrentPSTDateKey();
const DAY_COUNT = daysArg ? Math.max(1, parseInt(daysArg.slice('--days='.length), 10) || 1) : 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultOutPath(orgId: string, day: string): string {
  const shortOrg = orgId.slice(0, 8);
  return path.resolve(`reports/packing-${day}-${shortOrg}.csv`);
}

async function backfillDayEnrichment(pool: pg.Pool, orgId: string, day: string): Promise<number> {
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
      const days =
        DAY_COUNT > 1
          ? await listRecentFilledPackDays(ORG_ID as OrgId, DAY_COUNT, DAY)
          : [DAY];
      let total = 0;
      for (const day of days) {
        total += await backfillDayEnrichment(pool, ORG_ID, day);
      }
      console.log(`Backfilled packer_log_enrichment for ${total} PACK scan(s) across ${days.length} filled day(s).`);
    }

    const summary =
      DAY_COUNT > 1
        ? await getPackingKpisForLastFilledDays(ORG_ID as OrgId, DAY_COUNT, DAY)
        : await getPackingKpisForDay(ORG_ID as OrgId, DAY);
    const outPath = outArg ? path.resolve(outArg.slice('--out='.length)) : defaultOutPath(ORG_ID, DAY);
    const formatFlag = formatArg?.slice('--format='.length).trim().toLowerCase();
    const format =
      formatFlag === 'txt' || formatFlag === 'rtf' || formatFlag === 'csv'
        ? formatFlag
        : inferDocumentFormatFromPath(outPath);

    const content =
      format === 'csv'
        ? packerKpiSummaryToCsv(summary as Awaited<ReturnType<typeof getPackingKpisForDay>>)
        : DAY_COUNT > 1
          ? packerKpiPeriodToDocument(summary as Awaited<ReturnType<typeof getPackingKpisForLastFilledDays>>, format)
          : packerKpiSummaryToDocument(summary as Awaited<ReturnType<typeof getPackingKpisForDay>>, format);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');

    console.log(`Packing KPI report written: ${outPath}`);
    if (DAY_COUNT > 1) {
      const period = summary as Awaited<ReturnType<typeof getPackingKpisForLastFilledDays>>;
      console.log(`  Pack days:     ${period.filled_day_count} (${period.start_day} → ${period.end_day})`);
      console.log(`  Total boxes:   ${period.totals.total_boxes_packed}`);
      console.log(`  Weighted min:  ${period.totals.weighted_minutes}`);
      console.log(`  Packers:       ${period.by_packer.length}`);
      return;
    }

    const daySummary = summary as Awaited<ReturnType<typeof getPackingKpisForDay>>;
    console.log(`  Day (PST):     ${daySummary.day}`);
    console.log(`  Total boxes:   ${daySummary.totals.total_boxes_packed}`);
    console.log(`  Packers:       ${daySummary.by_packer.length}`);
    console.log(`  Totals:        small=${daySummary.totals.small_count} medium=${daySummary.totals.medium_count} large=${daySummary.totals.large_count}`);
    console.log(`  Weighted min:  ${daySummary.totals.weighted_minutes} / ${daySummary.capacity.daily_capacity_minutes} team capacity`);
    console.log(`  Workday min:   ${daySummary.capacity.workday_minutes} per packer (% of day denominator)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
