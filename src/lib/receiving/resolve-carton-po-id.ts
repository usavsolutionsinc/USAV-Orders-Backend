import { tenantQuery } from '@/lib/tenancy/db';

/**
 * Resolve the Zoho purchase-order id for a carton (receiving row).
 *
 * The PO id can live in two places and they DON'T always agree:
 *   • `receiving.zoho_purchaseorder_id`        — the carton/header link
 *   • `receiving_lines.zoho_purchaseorder_id`  — the per-line link (set by the
 *                                                Zoho PO matcher / import)
 *
 * For eBay-purchasing-imported cartons the header column is frequently NULL
 * while the line(s) carry the real PO id — which is why anything that resolved
 * the PO id from the header alone (e.g. the PO-header-notes push) silently
 * skipped with `no_zoho_link`, even though the per-line description push (which
 * reads the line) worked. This is the single resolver both paths should use.
 *
 * Returns the trimmed PO id, or null when the carton has no Zoho link at all.
 */
export async function resolveCartonZohoPoId(
  orgId: string,
  receivingId: number,
): Promise<string | null> {
  const res = await tenantQuery<{ zoho_purchaseorder_id: string | null }>(
    orgId,
    `SELECT COALESCE(
              NULLIF(r.zoho_purchaseorder_id, ''),
              (SELECT NULLIF(rl.zoho_purchaseorder_id, '')
                 FROM receiving_lines rl
                WHERE rl.receiving_id = r.id
                  AND rl.organization_id = r.organization_id
                  AND NULLIF(rl.zoho_purchaseorder_id, '') IS NOT NULL
                ORDER BY rl.id ASC
                LIMIT 1)
            ) AS zoho_purchaseorder_id
       FROM receiving r
      WHERE r.id = $1 AND r.organization_id = $2
      LIMIT 1`,
    [receivingId, orgId],
  );
  const v = String(res.rows[0]?.zoho_purchaseorder_id ?? '').trim();
  return v || null;
}
