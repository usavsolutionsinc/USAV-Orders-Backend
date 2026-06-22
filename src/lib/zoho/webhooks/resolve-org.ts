/**
 * Webhook → org resolution (Wave 3).
 *
 * Resolution strategy, most-trusted first:
 *
 *   1. PER-TENANT TOKEN (production multi-tenant path). The delivery arrives at
 *      /api/zoho/webhooks/{token}. The token maps O(1) to exactly one org via
 *      the unique organization_integrations.webhook_token index, and yields that
 *      org's OWN signing secret. Fully authenticated and unambiguous.
 *
 *   2. LEGACY GLOBAL SECRET (single-tenant bridge). The tokenless endpoint
 *      /api/zoho/webhooks authenticates with the global env ZOHO_WEBHOOK_SECRET
 *      and attributes the event to the transitional USAV org. This keeps USAV
 *      working until it is migrated to a per-tenant URL, then it is retired.
 *
 * The envelope's Zoho organization_id is NEVER used to *resolve* the tenant — it
 * is optional and sits OUTSIDE the HMAC, so it can't be trusted for routing. It
 * is used only as a post-verification *cross-check* (assertEventFromOrgZohoAccount)
 * to satisfy "validate the webhook is from an allowed Zoho account for that org".
 */

import {
  getIntegrationCredentials,
  type ZohoCredentials,
} from '@/lib/integrations/credentials';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveOrgByWebhookToken } from './zoho-webhook-credentials';
import type { NormalizedZohoEvent } from './types';

export type ResolveOrgResult =
  | {
      ok: true;
      orgId: OrgId;
      /** Per-org secret to verify the HMAC with; undefined → use global env. */
      signingSecret?: string;
      source: 'token' | 'legacy_global';
    }
  | { ok: false; status: 401 | 404; reason: string };

/**
 * Resolve the org a webhook delivery belongs to (before the body is parsed, so
 * the right secret is chosen for signature verification).
 */
export async function resolveOrgFromWebhook(params: {
  token?: string | null;
}): Promise<ResolveOrgResult> {
  const token = (params.token || '').trim();

  if (token) {
    const orgId = await resolveOrgByWebhookToken(token);
    if (!orgId) {
      // Unknown/revoked token — opaque to the caller, logged by the route.
      return { ok: false, status: 404, reason: 'unknown webhook token' };
    }
    const creds = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
    const signingSecret = creds?.webhookSecret;
    if (!signingSecret) {
      return { ok: false, status: 401, reason: 'webhook secret not provisioned for org' };
    }
    return { ok: true, orgId, signingSecret, source: 'token' };
  }

  // Legacy tokenless path → USAV via the global env secret (signingSecret
  // undefined; verifyZohoWebhookSignature falls back to ZOHO_WEBHOOK_SECRET).
  return { ok: true, orgId: transitionalUsavOrgId(), source: 'legacy_global' };
}

/**
 * Cross-check that a verified event actually came from the Zoho account this org
 * connected. Defense-in-depth on top of the per-org HMAC: even with a valid
 * signature, reject an event whose envelope Zoho organization_id doesn't match
 * the org's stored Zoho orgId. When the envelope omits organization_id (Zoho
 * frequently does on Workflow-Rule webhooks) we cannot check, so we allow it —
 * the HMAC already proved authenticity.
 */
export async function assertEventFromOrgZohoAccount(
  orgId: OrgId,
  event: NormalizedZohoEvent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const eventZohoOrg = (event.organizationId || '').trim();
  if (!eventZohoOrg) return { ok: true }; // nothing to validate against

  const creds = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
  const connectedZohoOrg = (creds?.orgId || '').trim();
  // No stored Zoho org id (USAV env-only legacy) → can't cross-check; allow.
  if (!connectedZohoOrg) return { ok: true };

  if (eventZohoOrg !== connectedZohoOrg) {
    return {
      ok: false,
      reason: `event Zoho org ${eventZohoOrg} does not match org ${orgId}'s connected Zoho account`,
    };
  }
  return { ok: true };
}
