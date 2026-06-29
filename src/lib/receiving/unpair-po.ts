/**
 * Operator-driven carton UNPAIR — the explicit revert of a Package-Pairing link.
 *
 * "I linked the wrong order/PO to this box by accident" → this fully reverts the
 * carton to its unmatched/Unfound state: it strips the per-line source-order
 * linkage (`source_order_id` / `is_repair_service` / `source_system`) AND the
 * carton's PO representative, dropping `source` back to `'unmatched'` and clearing
 * `source_platform`, so the box re-surfaces on the Unfound queue.
 *
 * Like {@link relinkReceivingPo}, this is a sanctioned, audited operator override
 * of the upgrade-only guard the general `PATCH /api/receiving/[id]` enforces — but
 * in the DOWNGRADE direction. It is deliberately deterministic (it does not lean on
 * `recomputeCartonSourceLink`'s ecwid-only revert guard) so it works for BOTH an
 * Ecwid-derived pairing and a real Zoho-PO link. Confirm-then-commit on the client;
 * the audit `before` snapshot makes it re-linkable.
 *
 * Inject `Deps` so unit tests run DB-free.
 */
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { TxClient } from './relink-po';

export interface UnpairCartonResult {
  ok: boolean;
  status: number;
  error?: string;
  receivingId: number;
  linesCleared: number;
  /** Carton state BEFORE the unpair — the audit snapshot / re-link hint. */
  before: {
    zoho_purchaseorder_id: string | null;
    zoho_purchaseorder_number: string | null;
    source: string | null;
    source_platform: string | null;
  } | null;
}

export interface UnpairDeps {
  runTx: <T>(orgId: string, fn: (client: TxClient) => Promise<T>) => Promise<T>;
}
const defaultDeps: UnpairDeps = {
  runTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
};

export async function unpairReceivingCarton(
  receivingId: number,
  orgId: string,
  deps: UnpairDeps = defaultDeps,
): Promise<UnpairCartonResult> {
  if (!Number.isFinite(receivingId) || receivingId <= 0) {
    return { ok: false, status: 400, error: 'invalid receiving_id', receivingId, linesCleared: 0, before: null };
  }

  return deps.runTx(orgId, async (client) => {
    const cartonRes = await client.query(
      `SELECT zoho_purchaseorder_id, zoho_purchaseorder_number, source, source_platform
         FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, orgId],
    );
    const before = cartonRes.rows[0] as UnpairCartonResult['before'];
    if (!before) {
      return { ok: false, status: 404, error: 'carton not found', receivingId, linesCleared: 0, before: null };
    }

    // ── Strip per-line linkage (source order + PO) ──────────────────────────
    // updated_at is trigger-maintained on receiving_lines (never set by hand).
    const linesRes = await client.query(
      `UPDATE receiving_lines
          SET source_order_id = NULL,
              is_repair_service = FALSE,
              source_system = NULL,
              zoho_purchaseorder_id = NULL,
              zoho_purchaseorder_number = NULL
        WHERE receiving_id = $1 AND organization_id = $2`,
      [receivingId, orgId],
    );

    // ── Revert the carton header to Unfound (explicit sanctioned downgrade) ──
    // Also clears listing_url: the listing was the pairing's (the Ecwid product),
    // so a full revert resets it — the chip falls back to empty for an unfound box.
    await client.query(
      `UPDATE receiving
          SET zoho_purchaseorder_id = NULL,
              zoho_purchaseorder_number = NULL,
              source = 'unmatched',
              source_platform = NULL,
              listing_url = NULL,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [receivingId, orgId],
    );

    return {
      ok: true,
      status: 200,
      receivingId,
      linesCleared: linesRes.rowCount ?? 0,
      before,
    };
  });
}
