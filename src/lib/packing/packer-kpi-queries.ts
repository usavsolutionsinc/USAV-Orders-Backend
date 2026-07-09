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

export type PackerDailyCsvRow = {
  packer: string;
  small: number;
  medium: number;
  large: number;
  weightedMin: number;
  percentOfDay: string;
};

export const PACKER_DAILY_CSV_COLUMNS: Array<{ key: keyof PackerDailyCsvRow; label: string }> = [
  { key: 'packer', label: 'Packer' },
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
      small: safeInt(row.small_count),
      medium: safeInt(row.medium_count),
      large: safeInt(row.large_count),
      weightedMin: weighted,
      percentOfDay: `${pct}%`,
    };
  });
}

export function packerKpiSummaryToCsv(summary: PackingKpiSummary): string {
  return toCsv(packerKpiSummaryToCsvRows(summary), PACKER_DAILY_CSV_COLUMNS);
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
          COALESCE(enr.pack_tier, 'MEDIUM') AS pack_tier,
          COALESCE(
            enr.estimated_pack_minutes,
            CASE COALESCE(enr.pack_tier, 'MEDIUM')
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
    totals: { ...totals, remaining_minutes },
    by_packer: rows.rows,
    fba: { pending_units, pending_weighted_minutes, avg_minutes_per_unit, fillable_units },
  };
}

