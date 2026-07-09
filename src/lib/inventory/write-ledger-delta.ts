import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';

export type LedgerDimension = 'WAREHOUSE' | 'BOXED';

export interface WriteLedgerDeltaInput {
  orgId: OrgId;
  sku: string;
  delta: number;
  reason: string;
  dimension?: LedgerDimension;
  staffId?: number | null;
  reasonCodeId?: number | null;
  notes?: string | null;
  refSerialUnitId?: number | null;
  refOrderId?: number | null;
  refShipmentId?: number | null;
  refSalId?: number | null;
}

/**
 * Canonical inventory quantity write — INSERT sku_stock_ledger only.
 *
 * Caller MUST run inside `withTenantTransaction(orgId, …)` so the GUC and
 * fn_recompute_sku_stock trigger project onto sku_stock. Never touches
 * sku_stock directly.
 */
export async function writeLedgerDelta(
  client: Pick<PoolClient, 'query'>,
  input: WriteLedgerDeltaInput,
): Promise<{ id: number; sku: string; delta: number } | null> {
  if (!input.orgId) {
    throw new Error('[writeLedgerDelta] orgId is required');
  }
  const sku = input.sku.trim();
  if (!sku) {
    throw new Error('[writeLedgerDelta] sku is required');
  }

  const result = await client.query<{ id: number; sku: string; delta: number }>(
    `INSERT INTO sku_stock_ledger (
       organization_id, sku, delta, reason, dimension, staff_id,
       reason_code_id, notes, ref_serial_unit_id, ref_order_id, ref_shipment_id, ref_sal_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, sku, delta`,
    [
      input.orgId,
      sku,
      input.delta,
      input.reason,
      input.dimension ?? 'WAREHOUSE',
      input.staffId ?? null,
      input.reasonCodeId ?? null,
      input.notes ?? null,
      input.refSerialUnitId ?? null,
      input.refOrderId ?? null,
      input.refShipmentId ?? null,
      input.refSalId ?? null,
    ],
  );
  return result.rows[0] ?? null;
}
