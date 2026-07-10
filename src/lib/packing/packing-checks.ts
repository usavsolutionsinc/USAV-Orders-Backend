/**
 * Packing-checklist tick persistence (packing-checklist-plan Phase 2).
 *
 * Records a packer's per-item confirmation ("this kit part / verify step is in
 * the box") into `tech_verifications` — the existing polymorphic checklist
 * results store — anchored on the order line:
 *
 *   source_kind    = 'order'
 *   source_row_id  = orders.id (the line PK the packer is packing)
 *   step_type      = 'PACKING'       (qc_check_templates verify steps)
 *                  | 'PACKING_PART'  (sku_kit_parts BOM rows)
 *   step_id        = the template / kit-part id
 *
 * Two step_type values because kit-part ids and check-template ids live in
 * different tables and would collide inside the single
 * `(source_kind, source_row_id, step_type, step_id)` idempotent-upsert key.
 * Both roll up under `step_type LIKE 'PACKING%'`.
 *
 * An untick upserts `passed = NULL` (clears the confirmation) rather than
 * deleting, so re-marks stay a single-row UPDATE and the verified_by/at trail
 * survives. The upsert key itself is the idempotency guarantee — a client
 * retry with the same tick is a no-op re-mark.
 *
 * Parent-existence validation happens here in the domain helper (order line +
 * step must exist in the caller's org), per the polymorphic-tables contract —
 * never in a DB trigger.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  upsertVerification,
  type TechVerificationRow,
} from '@/lib/neon/sku-catalog-queries';

export type PackingTickKind = 'KIT_PART' | 'PACKING_CHECK';

/** step_type discriminators written to tech_verifications. */
export const PACKING_STEP_TYPE: Record<PackingTickKind, string> = {
  KIT_PART: 'PACKING_PART',
  PACKING_CHECK: 'PACKING',
};

export interface RecordPackingTickArgs {
  orderRowId: number;
  kind: PackingTickKind;
  /** sku_kit_parts.id (KIT_PART) or qc_check_templates.id (PACKING_CHECK). */
  stepId: number;
  checked: boolean;
  verifiedBy: number;
}

export type RecordPackingTickResult =
  | { ok: true; verification: TechVerificationRow; stepType: string }
  | { ok: false; status: 404 | 409; error: string };

/** Injectable collaborators so unit tests run DB-free (house Deps pattern). */
export interface PackingChecksDeps {
  query: (
    orgId: OrgId,
    sql: string,
    params: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  upsertVerification: typeof upsertVerification;
}

const defaultDeps: PackingChecksDeps = {
  query: (orgId, sql, params) => tenantQuery(orgId, sql, params),
  upsertVerification,
};

export async function recordPackingTick(
  orgId: OrgId,
  args: RecordPackingTickArgs,
  deps: PackingChecksDeps = defaultDeps,
): Promise<RecordPackingTickResult> {
  // 1. The order line must exist in this org (polymorphic parent validation).
  const order = await deps.query(
    orgId,
    `SELECT id, sku_catalog_id FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [args.orderRowId, orgId],
  );
  if (order.rows.length === 0) {
    return { ok: false, status: 404, error: 'order not found' };
  }
  const orderCatalogId =
    order.rows[0].sku_catalog_id == null ? null : Number(order.rows[0].sku_catalog_id);

  // 2. Resolve the step row + the NOT NULL sku_catalog_id it belongs to.
  let skuCatalogId: number | null = null;
  if (args.kind === 'KIT_PART') {
    const part = await deps.query(
      orgId,
      `SELECT sku_catalog_id FROM sku_kit_parts WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [args.stepId, orgId],
    );
    if (part.rows.length === 0) {
      return { ok: false, status: 404, error: 'kit part not found' };
    }
    skuCatalogId = Number(part.rows[0].sku_catalog_id);
  } else {
    const step = await deps.query(
      orgId,
      `SELECT sku_catalog_id FROM qc_check_templates WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [args.stepId, orgId],
    );
    if (step.rows.length === 0) {
      return { ok: false, status: 404, error: 'check step not found' };
    }
    // Category-level templates carry no sku_catalog_id — fall back to the
    // order line's resolved catalog row (tech_verifications.sku_catalog_id is
    // NOT NULL).
    skuCatalogId =
      step.rows[0].sku_catalog_id == null
        ? orderCatalogId
        : Number(step.rows[0].sku_catalog_id);
  }
  if (skuCatalogId == null || !Number.isFinite(skuCatalogId)) {
    return {
      ok: false,
      status: 409,
      error: 'cannot resolve a SKU catalog row for this step',
    };
  }

  const stepType = PACKING_STEP_TYPE[args.kind];
  const verification = await deps.upsertVerification(
    {
      sourceKind: 'order',
      sourceRowId: args.orderRowId,
      skuCatalogId,
      stepType,
      stepId: args.stepId,
      // Untick clears the confirmation (passed = NULL) instead of deleting.
      passed: args.checked ? true : null,
      verifiedBy: args.verifiedBy,
    },
    orgId,
  );

  return { ok: true, verification, stepType };
}
