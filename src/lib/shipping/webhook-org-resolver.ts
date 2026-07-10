/**
 * Webhook org resolution — session-less carrier/marketplace callbacks.
 *
 * Carrier pushes (USPS/FedEx/UPS) and Square notifications arrive with no
 * session, so the receiving route must derive the owning org from the payload
 * itself. This module is the single place that mapping lives:
 *
 *   • tracking number → org via `shipping_tracking_numbers` (the registration
 *     table the tracking-poll cron writes), falling back to the linked
 *     `orders.organization_id` for as-yet-unstamped (NULL-org) rows.
 *   • Square merchant_id → org via `organization_integrations`
 *     (provider = 'square'), preferring an exact `scope` match over the
 *     common single-account NULL-scope row.
 *
 * FAIL-CLOSED: ambiguous (2+ candidate orgs) or missing mappings return null —
 * the caller must SKIP the event, never write under a guessed org. The lookups
 * are deliberately unscoped reads (the whole point is to FIND the org) and
 * return organization_id only.
 *
 * Deps are injectable so unit tests run DB-free (see webhook-org-resolver.test.ts).
 */
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { normalizeTrackingNumber } from '@/lib/tracking-format';

interface OrgLookupRow {
  organization_id: string | null;
  scope?: string | null;
}

export interface WebhookOrgResolverDeps {
  /** Unscoped read-only query returning organization_id (+ scope for Square). */
  query: (text: string, params: ReadonlyArray<unknown>) => Promise<{ rows: OrgLookupRow[] }>;
  warn: (message: string, meta: Record<string, unknown>) => void;
}

const defaultDeps: WebhookOrgResolverDeps = {
  query: (text, params) => pool.query<OrgLookupRow>(text, params as unknown[]),
  warn: (message, meta) => console.warn(message, meta),
};

function distinctOrgs(rows: OrgLookupRow[]): OrgId[] {
  const orgs = new Set<string>();
  for (const row of rows) {
    if (row.organization_id) orgs.add(row.organization_id);
  }
  return [...orgs] as OrgId[];
}

/**
 * Resolve the owning org for a carrier webhook event by tracking number.
 * Returns null (never a guess) when the number is unknown or owned by more
 * than one org — callers skip that event and let the carrier retry/drop it.
 */
export async function resolveWebhookOrgByTracking(
  trackingNumber: string,
  deps: WebhookOrgResolverDeps = defaultDeps,
): Promise<OrgId | null> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!normalized) return null;

  // 1. The registration table the tracking-poll cron reads/writes. The natural
  //    key is global on tracking_number_normalized today, but DISTINCT keeps
  //    this correct if the unique is ever re-scoped per org.
  const registered = await deps.query(
    `SELECT DISTINCT organization_id
       FROM shipping_tracking_numbers
      WHERE tracking_number_normalized = $1
        AND organization_id IS NOT NULL`,
    [normalized],
  );
  const registeredOrgs = distinctOrgs(registered.rows);
  if (registeredOrgs.length === 1) return registeredOrgs[0];
  if (registeredOrgs.length > 1) {
    deps.warn('[webhook-org] ambiguous tracking — multiple owning orgs', {
      tracking: normalized,
      orgCount: registeredOrgs.length,
    });
    return null;
  }

  // 2. Fallback for unstamped (NULL-org) registration rows: the linked orders.
  const linked = await deps.query(
    `SELECT DISTINCT o.organization_id
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE stn.tracking_number_normalized = $1
        AND o.organization_id IS NOT NULL`,
    [normalized],
  );
  const linkedOrgs = distinctOrgs(linked.rows);
  if (linkedOrgs.length === 1) return linkedOrgs[0];
  if (linkedOrgs.length > 1) {
    deps.warn('[webhook-org] ambiguous tracking — multiple linked-order orgs', {
      tracking: normalized,
      orgCount: linkedOrgs.length,
    });
  }
  return null;
}

/**
 * Resolve the owning org for a Square webhook by the payload's merchant_id.
 * Exact `scope` matches (multi-account orgs store the merchant id there) beat
 * the common single-account NULL-scope connection; ambiguity returns null.
 */
export async function resolveWebhookOrgForSquareMerchant(
  merchantId: string,
  deps: WebhookOrgResolverDeps = defaultDeps,
): Promise<OrgId | null> {
  const trimmed = merchantId.trim();
  if (!trimmed) return null;

  const result = await deps.query(
    `SELECT organization_id, scope
       FROM organization_integrations
      WHERE provider = 'square'
        AND status = 'active'
        AND (scope = $1 OR scope IS NULL)`,
    [trimmed],
  );

  const exactOrgs = distinctOrgs(result.rows.filter((row) => row.scope === trimmed));
  if (exactOrgs.length === 1) return exactOrgs[0];
  if (exactOrgs.length > 1) {
    deps.warn('[webhook-org] ambiguous square merchant — multiple exact-scope orgs', {
      merchantId: trimmed,
      orgCount: exactOrgs.length,
    });
    return null;
  }

  const fallbackOrgs = distinctOrgs(result.rows.filter((row) => row.scope == null));
  if (fallbackOrgs.length === 1) return fallbackOrgs[0];
  if (fallbackOrgs.length > 1) {
    deps.warn('[webhook-org] ambiguous square merchant — multiple NULL-scope orgs', {
      merchantId: trimmed,
      orgCount: fallbackOrgs.length,
    });
  }
  return null;
}
