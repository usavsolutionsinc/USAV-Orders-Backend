import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { toCsv } from '@/lib/warranty/reports';
import { DEFAULT_TIER_MINUTES } from '@/lib/packing/pack-tier-classifier';

export type PackingReportRow = {
  packedAt: string;
  packerName: string | null;
  sku: string | null;
  productTitle: string | null;
  packTier: string;
  estimatedMinutes: number;
  trackingType: string | null;
  trackingOrScanRef: string | null;
};

export const PACKING_REPORT_COLUMNS: Array<{ key: keyof PackingReportRow; label: string }> = [
  { key: 'packedAt', label: 'Packed at' },
  { key: 'packerName', label: 'Packer' },
  { key: 'sku', label: 'SKU' },
  { key: 'productTitle', label: 'Product' },
  { key: 'packTier', label: 'Pack tier' },
  { key: 'estimatedMinutes', label: 'Estimated minutes' },
  { key: 'trackingType', label: 'Tracking type' },
  { key: 'trackingOrScanRef', label: 'Tracking / scan ref' },
];

export function packingRowsToCsv(rows: PackingReportRow[]): string {
  return toCsv(rows, PACKING_REPORT_COLUMNS);
}

export async function buildPackingReportRows(
  filters: { day: string; packerId?: number | null },
  orgId: OrgId,
): Promise<PackingReportRow[]> {
  const params: unknown[] = [orgId, filters.day];
  let packerPredicate = '';
  if (filters.packerId && Number.isFinite(filters.packerId)) {
    params.push(filters.packerId);
    packerPredicate = ` AND sal.staff_id = $${params.length}`;
  }

  const sql = `
    SELECT
      sal.created_at::text AS packed_at,
      s.name AS packer_name,
      COALESCE(enr.resolved_sku, o.sku) AS sku,
      COALESCE(o.product_title, enr.external_product_title) AS product_title,
      COALESCE(enr.pack_tier, 'SMALL') AS pack_tier,
      COALESCE(
        enr.estimated_pack_minutes,
        CASE COALESCE(enr.pack_tier, 'SMALL')
          WHEN 'SMALL' THEN ${DEFAULT_TIER_MINUTES.SMALL}
          WHEN 'LARGE' THEN ${DEFAULT_TIER_MINUTES.LARGE}
          ELSE ${DEFAULT_TIER_MINUTES.MEDIUM}
        END
      )::int AS estimated_minutes,
      pl.tracking_type AS tracking_type,
      COALESCE(stn.tracking_number_raw, sal.scan_ref) AS tracking_or_scan_ref
    FROM station_activity_logs sal
    LEFT JOIN packer_log_enrichment enr ON enr.sal_id = sal.id
    LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
    LEFT JOIN orders o ON o.id = enr.order_row_id AND o.organization_id = sal.organization_id
    LEFT JOIN shipping_tracking_numbers stn ON stn.id = COALESCE(pl.shipment_id, sal.shipment_id)
    LEFT JOIN staff s ON s.id = sal.staff_id
    WHERE sal.station = 'PACK'
      AND sal.activity_type = 'PACK_COMPLETED'
      AND sal.organization_id = $1
      AND (timezone('America/Los_Angeles', sal.created_at))::date = $2::date
      ${packerPredicate}
    ORDER BY sal.created_at DESC
    LIMIT 10000
  `;

  const result = await tenantQuery<{
    packed_at: string;
    packer_name: string | null;
    sku: string | null;
    product_title: string | null;
    pack_tier: string;
    estimated_minutes: number;
    tracking_type: string | null;
    tracking_or_scan_ref: string | null;
  }>(orgId, sql, params);

  return result.rows.map((r) => ({
    packedAt: r.packed_at,
    packerName: r.packer_name,
    sku: r.sku,
    productTitle: r.product_title,
    packTier: r.pack_tier,
    estimatedMinutes: Number(r.estimated_minutes) || 0,
    trackingType: r.tracking_type,
    trackingOrScanRef: r.tracking_or_scan_ref,
  }));
}

