/**
 * Operator-driven PO relink — the website is authoritative over Zoho.
 *
 * "Someone linked the wrong PO/SKU in Zoho, but I know the correct PO" → this
 * writes the chosen PO (and an optional SKU correction) onto the line AND the
 * carton header, even when Zoho already had a different (wrong) link. It
 * DELIBERATELY overrides the upgrade-only guard that the general
 * `PATCH /api/receiving/[id]` enforces (that guard exists so a passive sync
 * can't downgrade a carton; an explicit operator relink is the sanctioned
 * exception).
 *
 * SoT note (items vs sku_catalog collision): a SKU correction rewrites `sku` +
 * `zoho_item_id` only. We do NOT derive `sku_catalog_id` from the SKU string
 * here — the read-side title-guarded join owns that (the two SKU namespaces
 * collide; see source-of-truth rules). Inject `Deps` so unit tests run DB-free.
 */
import { withTenantTransaction } from '@/lib/tenancy/db';
import { recomputeCartonSourceLink } from './carton-source-link';

export type RelinkScope = 'line' | 'carton' | 'both';

export interface RelinkPoInput {
  receivingId: number;
  /** Required for scope 'line' | 'both' — the line whose PO/SKU is rewritten. */
  lineId?: number | null;
  scope: RelinkScope;
  zohoPurchaseorderId: string;
  zohoPurchaseorderNumber?: string | null;
  /** Optional SKU correction (the "wrong SKU on the right PO" fix). */
  sku?: string | null;
  zohoItemId?: string | null;
}

export interface RelinkPoResult {
  ok: boolean;
  status: number;
  error?: string;
  receivingId: number;
  linesUpdated: number;
  poId: string;
  poNumber: string | null;
}

/** Minimal query surface — lets the unit test pass a fake client (DB-free). */
export interface TxClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface RelinkDeps {
  recompute: (receivingId: number, db: TxClient) => Promise<void>;
  /** Transaction runner — defaults to withTenantTransaction; faked in tests. */
  runTx: <T>(orgId: string, fn: (client: TxClient) => Promise<T>) => Promise<T>;
}
const defaultDeps: RelinkDeps = {
  recompute: (receivingId, db) => recomputeCartonSourceLink(receivingId, db),
  runTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
};

export async function relinkReceivingPo(
  input: RelinkPoInput,
  orgId: string,
  deps: RelinkDeps = defaultDeps,
): Promise<RelinkPoResult> {
  const { receivingId, lineId, scope, zohoPurchaseorderId } = input;
  const poNumber = input.zohoPurchaseorderNumber?.trim() || null;
  const sku = input.sku?.trim() || null;
  const zohoItemId = input.zohoItemId?.trim() || null;

  return deps.runTx(orgId, async (client) => {
    const carton = await client.query(
      `SELECT id FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, orgId],
    );
    if (carton.rowCount === 0) {
      return {
        ok: false, status: 404, error: 'carton not found',
        receivingId, linesUpdated: 0, poId: zohoPurchaseorderId, poNumber,
      };
    }

    // ── LINE rewrite ────────────────────────────────────────────────────────
    // updated_at is trigger-maintained on receiving_lines (never set by hand).
    let linesUpdated = 0;
    if (scope === 'carton') {
      // Re-point every line of the carton at the chosen PO.
      const res = await client.query(
        `UPDATE receiving_lines
            SET zoho_purchaseorder_id = $1, zoho_purchaseorder_number = $2
          WHERE receiving_id = $3 AND organization_id = $4`,
        [zohoPurchaseorderId, poNumber, receivingId, orgId],
      );
      linesUpdated = res.rowCount ?? 0;
    } else if (lineId != null && lineId > 0) {
      // Re-point this line, plus the optional SKU correction.
      const res = await client.query(
        `UPDATE receiving_lines
            SET zoho_purchaseorder_id = $1,
                zoho_purchaseorder_number = $2,
                sku = COALESCE($5, sku),
                zoho_item_id = COALESCE($6, zoho_item_id)
          WHERE id = $3 AND receiving_id = $7 AND organization_id = $4`,
        [zohoPurchaseorderId, poNumber, lineId, orgId, sku, zohoItemId, receivingId],
      );
      linesUpdated = res.rowCount ?? 0;
    }

    // ── CARTON header rewrite (explicit override of upgrade-only) ────────────
    if (scope === 'carton' || scope === 'both') {
      await client.query(
        `UPDATE receiving
            SET zoho_purchaseorder_id = $1,
                zoho_purchaseorder_number = $2,
                source = 'zoho_po',
                updated_at = NOW()
          WHERE id = $3 AND organization_id = $4`,
        [zohoPurchaseorderId, poNumber, receivingId, orgId],
      );
    }

    // Re-derive the carton's representative source link. No-op for a real-Zoho
    // carton (guarded inside), so it can't undo what we just wrote.
    await deps.recompute(receivingId, client);

    return {
      ok: true, status: 200,
      receivingId, linesUpdated, poId: zohoPurchaseorderId, poNumber,
    };
  });
}
