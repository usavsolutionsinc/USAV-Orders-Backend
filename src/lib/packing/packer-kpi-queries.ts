import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { DEFAULT_TIER_MINUTES, type PackTier } from '@/lib/packing/pack-tier-classifier';
import { toCsv } from '@/lib/warranty/reports';

export type PackerKpiRow = {
  staff_id: number;
  staff_name: string | null;
  small_count: number;
  medium_count: number;
  large_count: number;
  weighted_minutes: number;
};

export type PackingCapacity = {
  packer_headcount: number;
  workday_minutes: number;
  daily_capacity_minutes: number;
  daily_medium_target: number;
  daily_large_target: number;
};

export type PackingKpiSummary = {
  day: string; // YYYY-MM-DD PST
  capacity: PackingCapacity;
  totals: {
    small_count: number;
    medium_count: number;
    large_count: number;
    total_boxes_packed: number;
    weighted_minutes: number;
    remaining_minutes: number;
  };
  by_packer: PackerKpiRow[];
  fba: {
    pending_units: number;
    pending_weighted_minutes: number;
    avg_minutes_per_unit: number | null;
    fillable_units: number;
  };
};

export type PackingKpiPeriodSummary = {
  start_day: string;
  end_day: string;
  /** Calendar span when using fixed window; equals filled_day_count for filled-day mode. */
  day_count: number;
  /** Days that actually had pack scans (no zero-volume placeholders). */
  filled_day_count: number;
  capacity: PackingCapacity;
  daily: PackingKpiSummary[];
  totals: PackingKpiSummary['totals'];
  by_packer: PackerKpiRow[];
};

export function totalBoxesPacked(counts: {
  small_count: number;
  medium_count: number;
  large_count: number;
}): number {
  return safeInt(counts.small_count) + safeInt(counts.medium_count) + safeInt(counts.large_count);
}

export function addDaysToPstDateKey(day: string, delta: number): string {
  const [year, month, dayNum] = day.split('-').map(Number);
  const date = new Date(year, month - 1, dayNum);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function lastNPstDateKeys(endDay: string, count: number): string[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => addDaysToPstDateKey(endDay, -(n - 1 - i)));
}

export type PackerDailyCsvRow = {
  packer: string;
  boxes: number;
  small: number;
  medium: number;
  large: number;
  weightedMin: number;
  percentOfDay: string;
};

export const PACKER_DAILY_CSV_COLUMNS: Array<{ key: keyof PackerDailyCsvRow; label: string }> = [
  { key: 'packer', label: 'Packer' },
  { key: 'boxes', label: 'Boxes' },
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
  { key: 'weightedMin', label: 'Weighted min' },
  { key: 'percentOfDay', label: '% of day' },
];

export function packerKpiSummaryToCsvRows(summary: PackingKpiSummary): PackerDailyCsvRow[] {
  const workdayMinutes = Math.max(1, summary.capacity.workday_minutes);
  return summary.by_packer.map((row) => {
    const weighted = safeInt(row.weighted_minutes);
    const pct = ((weighted / workdayMinutes) * 100).toFixed(1);
    return {
      packer: row.staff_name?.trim() || `Staff #${row.staff_id}`,
      boxes: safeInt(row.small_count) + safeInt(row.medium_count) + safeInt(row.large_count),
      small: safeInt(row.small_count),
      medium: safeInt(row.medium_count),
      large: safeInt(row.large_count),
      weightedMin: weighted,
      percentOfDay: `${pct}%`,
    };
  });
}

export function packerKpiSummaryToCsv(summary: PackingKpiSummary): string {
  const table = toCsv(packerKpiSummaryToCsvRows(summary), PACKER_DAILY_CSV_COLUMNS);
  const footer = packingReportFooterLines(summary).join('\r\n');
  return `${table}\r\n\r\n${footer}`;
}

/** Micro-copy appended below the per-packer table in downloadable reports. */
export function packingReportFooterLines(summary: PackingKpiSummary): string[] {
  const { SMALL, MEDIUM, LARGE } = DEFAULT_TIER_MINUTES;
  const workday = summary.capacity.workday_minutes;
  return [
    'Notes',
    `Report date (PST): ${summary.day}`,
    '',
    `Weighted min — Sum of estimated pack time for each completed pack scan that day. Per scan: use the SKU pack profile minutes when one is linked; otherwise use the tier default (Small ${SMALL} min, Medium ${MEDIUM} min, Large ${LARGE} min).`,
    '',
    'Small / Medium / Large — Each packed item is bucketed by pack tier. Small = pack-and-label parts; Medium = semi-complete systems needing prep; Large = full heavy home theater stacks. Tiers come from operator SKU profiles, CLEAN scans, or product-title rules (not a blanket Medium default).',
    '',
    `% of day — That packer's weighted minutes divided by a ${workday}-minute workday (${workday / 60} hours). Example: 65% ≈ ${Math.round(workday * 0.65)} minutes of pack work. Does not include breaks or non-pack tasks.`,
  ];
}

function safeInt(n: unknown, fallback = 0): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

function tierMinutes(tier: PackTier): number {
  return DEFAULT_TIER_MINUTES[tier] ?? DEFAULT_TIER_MINUTES.MEDIUM;
}

export async function getOrgPackCapacity(orgId: OrgId): Promise<PackingCapacity> {
  const result = await tenantQuery<{
    packer_headcount: number;
    workday_minutes: number;
    daily_medium_target: number;
    daily_large_target: number;
  }>(
    orgId,
    `SELECT packer_headcount, workday_minutes, daily_medium_target, daily_large_target
       FROM org_pack_capacity
      WHERE organization_id = $1
      LIMIT 1`,
    [orgId],
  );

  const row = result.rows[0];
  const packer_headcount = safeInt(row?.packer_headcount, 2);
  const workday_minutes = safeInt(row?.workday_minutes, 480);
  const daily_medium_target = safeInt(row?.daily_medium_target, 60);
  const daily_large_target = safeInt(row?.daily_large_target, 16);
  return {
    packer_headcount,
    workday_minutes,
    daily_capacity_minutes: Math.max(0, packer_headcount * workday_minutes),
    daily_medium_target,
    daily_large_target,
  };
}

export async function getPackingKpisForDay(orgId: OrgId, dayPst: string): Promise<PackingKpiSummary> {
  const capacity = await getOrgPackCapacity(orgId);

  const rows = await tenantQuery<PackerKpiRow>(
    orgId,
    `
      WITH pack_rows AS (
        SELECT
          sal.staff_id,
          COALESCE(enr.pack_tier, 'SMALL') AS pack_tier,
          COALESCE(
            enr.estimated_pack_minutes,
            CASE COALESCE(enr.pack_tier, 'SMALL')
              WHEN 'SMALL' THEN ${tierMinutes('SMALL')}
              WHEN 'LARGE' THEN ${tierMinutes('LARGE')}
              ELSE ${tierMinutes('MEDIUM')}
            END
          )::int AS minutes
        FROM station_activity_logs sal
        LEFT JOIN packer_log_enrichment enr ON enr.sal_id = sal.id
        WHERE sal.station = 'PACK'
          AND sal.activity_type = 'PACK_COMPLETED'
          AND sal.organization_id = $1
          AND (timezone('America/Los_Angeles', sal.created_at))::date = $2::date
          AND sal.staff_id IS NOT NULL
      )
      SELECT
        pr.staff_id,
        s.name AS staff_name,
        COUNT(*) FILTER (WHERE pr.pack_tier = 'SMALL')::int  AS small_count,
        COUNT(*) FILTER (WHERE pr.pack_tier = 'MEDIUM')::int AS medium_count,
        COUNT(*) FILTER (WHERE pr.pack_tier = 'LARGE')::int  AS large_count,
        COALESCE(SUM(pr.minutes), 0)::int                    AS weighted_minutes
      FROM pack_rows pr
      LEFT JOIN staff s ON s.id = pr.staff_id
      GROUP BY pr.staff_id, s.name
      ORDER BY weighted_minutes DESC, pr.staff_id ASC
    `,
    [orgId, dayPst],
  );

  const totals = rows.rows.reduce(
    (acc, r) => {
      acc.small_count += safeInt(r.small_count);
      acc.medium_count += safeInt(r.medium_count);
      acc.large_count += safeInt(r.large_count);
      acc.weighted_minutes += safeInt(r.weighted_minutes);
      return acc;
    },
    { small_count: 0, medium_count: 0, large_count: 0, weighted_minutes: 0 },
  );
  const total_boxes_packed = totalBoxesPacked(totals);

  const remaining_minutes = Math.max(0, capacity.daily_capacity_minutes - totals.weighted_minutes);

  // FBA pending (non-shipped) estimate: sum outstanding expected-actual qty × sku minutes.
  const fbaRes = await tenantQuery<{
    pending_units: number;
    pending_weighted_minutes: number;
  }>(
    orgId,
    `
      WITH pending AS (
        SELECT
          GREATEST(0, COALESCE(fsi.expected_qty, 0) - COALESCE(fsi.actual_qty, 0))::int AS pending_units,
          sc.id AS sku_catalog_id,
          sc.product_title
        FROM fba_shipment_items fsi
        JOIN fba_shipments fs ON fs.id = fsi.shipment_id
        LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku AND ff.organization_id = fsi.organization_id
        LEFT JOIN sku_catalog sc ON sc.id = ff.sku_catalog_id AND sc.organization_id = fsi.organization_id
        WHERE fs.status != 'SHIPPED'
          AND fsi.status NOT IN ('SHIPPED', 'LABEL_ASSIGNED')
          AND fsi.organization_id = $1
      ),
      resolved AS (
        SELECT
          p.pending_units,
          COALESCE(pp.pack_tier, 'MEDIUM') AS pack_tier,
          COALESCE(
            pp.estimated_minutes,
            CASE COALESCE(pp.pack_tier, 'MEDIUM')
              WHEN 'SMALL' THEN ${tierMinutes('SMALL')}
              WHEN 'LARGE' THEN ${tierMinutes('LARGE')}
              ELSE ${tierMinutes('MEDIUM')}
            END
          )::int AS minutes
        FROM pending p
        LEFT JOIN LATERAL (
          SELECT pr.pack_tier, pr.estimated_minutes
          FROM pack_profile_links ppl
          JOIN pack_profiles pr ON pr.id = ppl.pack_profile_id
          WHERE ppl.organization_id = $1
            AND ppl.owner_type = 'SKU_CATALOG'
            AND ppl.owner_id = p.sku_catalog_id
          LIMIT 1
        ) pp ON TRUE
      )
      SELECT
        COALESCE(SUM(pending_units), 0)::int AS pending_units,
        COALESCE(SUM(pending_units * minutes), 0)::int AS pending_weighted_minutes
      FROM resolved
    `,
    [orgId],
  );

  const pending_units = safeInt(fbaRes.rows[0]?.pending_units);
  const pending_weighted_minutes = safeInt(fbaRes.rows[0]?.pending_weighted_minutes);
  const avg_minutes_per_unit = pending_units > 0 ? pending_weighted_minutes / pending_units : null;
  const fillable_units =
    avg_minutes_per_unit && avg_minutes_per_unit > 0 ? Math.floor(remaining_minutes / avg_minutes_per_unit) : 0;

  return {
    day: dayPst,
    capacity,
    totals: { ...totals, total_boxes_packed, remaining_minutes },
    by_packer: rows.rows,
    fba: { pending_units, pending_weighted_minutes, avg_minutes_per_unit, fillable_units },
  };
}

function mergePackerRows(rows: PackerKpiRow[]): PackerKpiRow[] {
  const byId = new Map<number, PackerKpiRow>();
  for (const row of rows) {
    const existing = byId.get(row.staff_id);
    if (!existing) {
      byId.set(row.staff_id, { ...row });
      continue;
    }
    existing.small_count += safeInt(row.small_count);
    existing.medium_count += safeInt(row.medium_count);
    existing.large_count += safeInt(row.large_count);
    existing.weighted_minutes += safeInt(row.weighted_minutes);
    if (!existing.staff_name && row.staff_name) existing.staff_name = row.staff_name;
  }
  return [...byId.values()].sort(
    (a, b) => safeInt(b.weighted_minutes) - safeInt(a.weighted_minutes) || a.staff_id - b.staff_id,
  );
}

export async function listRecentFilledPackDays(
  orgId: OrgId,
  limit: number,
  asOfDayPst?: string,
): Promise<string[]> {
  const cap = Math.max(1, Math.floor(limit));
  const params: unknown[] = [orgId];
  let asOfClause = '';
  if (asOfDayPst) {
    params.push(asOfDayPst);
    asOfClause = `AND (timezone('America/Los_Angeles', sal.created_at))::date <= $${params.length}::date`;
  }
  params.push(cap);

  const result = await tenantQuery<{ pack_day: string }>(
    orgId,
    `SELECT DISTINCT (timezone('America/Los_Angeles', sal.created_at))::date::text AS pack_day
       FROM station_activity_logs sal
      WHERE sal.station = 'PACK'
        AND sal.activity_type = 'PACK_COMPLETED'
        AND sal.organization_id = $1
        ${asOfClause}
      ORDER BY pack_day DESC
      LIMIT $${params.length}`,
    params,
  );

  return result.rows.map((r) => r.pack_day).reverse();
}

function buildPeriodSummaryFromDaily(
  daily: PackingKpiSummary[],
  capacity: PackingCapacity,
): PackingKpiPeriodSummary {
  const filled = daily.filter((d) => d.totals.total_boxes_packed > 0);
  const totals = filled.reduce(
    (acc, summary) => {
      acc.small_count += summary.totals.small_count;
      acc.medium_count += summary.totals.medium_count;
      acc.large_count += summary.totals.large_count;
      acc.weighted_minutes += summary.totals.weighted_minutes;
      return acc;
    },
    { small_count: 0, medium_count: 0, large_count: 0, weighted_minutes: 0 },
  );
  const total_boxes_packed = totalBoxesPacked(totals);
  const periodCapacityMinutes = capacity.daily_capacity_minutes * filled.length;

  return {
    start_day: filled[0]?.day ?? daily[0]?.day ?? '',
    end_day: filled[filled.length - 1]?.day ?? daily[daily.length - 1]?.day ?? '',
    day_count: filled.length,
    filled_day_count: filled.length,
    capacity,
    daily: filled,
    totals: {
      ...totals,
      total_boxes_packed,
      remaining_minutes: Math.max(0, periodCapacityMinutes - totals.weighted_minutes),
    },
    by_packer: mergePackerRows(filled.flatMap((summary) => summary.by_packer)),
  };
}

/** Last N PST days that had at least one completed pack scan (no empty calendar gaps). */
export async function getPackingKpisForLastFilledDays(
  orgId: OrgId,
  filledDayCount: number,
  asOfDayPst?: string,
): Promise<PackingKpiPeriodSummary> {
  const days = await listRecentFilledPackDays(orgId, filledDayCount, asOfDayPst);
  if (days.length === 0) {
    const capacity = await getOrgPackCapacity(orgId);
    return {
      start_day: asOfDayPst ?? '',
      end_day: asOfDayPst ?? '',
      day_count: 0,
      filled_day_count: 0,
      capacity,
      daily: [],
      totals: {
        small_count: 0,
        medium_count: 0,
        large_count: 0,
        total_boxes_packed: 0,
        weighted_minutes: 0,
        remaining_minutes: 0,
      },
      by_packer: [],
    };
  }

  const daily = await Promise.all(days.map((day) => getPackingKpisForDay(orgId, day)));
  const capacity = daily[daily.length - 1]?.capacity ?? (await getOrgPackCapacity(orgId));
  return buildPeriodSummaryFromDaily(daily, capacity);
}

export async function getPackingKpisForPeriod(
  orgId: OrgId,
  endDayPst: string,
  dayCount: number,
): Promise<PackingKpiPeriodSummary> {
  const days = lastNPstDateKeys(endDayPst, dayCount);
  const daily = await Promise.all(days.map((day) => getPackingKpisForDay(orgId, day)));
  const capacity = daily[daily.length - 1]?.capacity ?? (await getOrgPackCapacity(orgId));
  const summary = buildPeriodSummaryFromDaily(daily, capacity);
  return {
    ...summary,
    day_count: days.length,
    filled_day_count: summary.daily.length,
  };
}

