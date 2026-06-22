/**
 * Per-tenant Zoho webhook identity (Wave 3).
 *
 * Each org that connects Zoho gets:
 *   - an opaque `webhookToken` used in its per-tenant webhook URL
 *     (/api/zoho/webhooks/{webhookToken}) — mirrored to the indexed
 *     organization_integrations.webhook_token column for O(1) token→org lookup;
 *   - its OWN HMAC `webhookSecret`, stored ENCRYPTED in the integration payload,
 *     used to authenticate that org's deliveries.
 *
 * This mirrors how Stripe Connect / GitHub Apps / Square solve multi-tenant
 * webhooks: the URL identifies the tenant, a per-tenant secret authenticates it.
 */

import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';
import {
  getIntegrationCredentials,
  invalidateCredentialCache,
  type ZohoCredentials,
} from '@/lib/integrations/credentials';
import { encryptIntegrationPayload } from '@/lib/integrations/crypto';
import type { OrgId } from '@/lib/tenancy/constants';

export interface ZohoWebhookIdentity {
  webhookToken: string;
  webhookSecret: string;
}

/** URL-safe, unguessable (256-bit) token for the per-tenant webhook path. */
function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 256-bit hex HMAC secret the tenant configures in Zoho's webhook console. */
function mintSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Ensure the org's Zoho connection has a webhook token + secret, minting and
 * persisting them on first call. Idempotent: returns the existing identity on
 * subsequent calls. Throws if the org has not connected Zoho.
 *
 * The secret is returned so a caller (the OAuth callback / a "reveal" admin
 * action) can display it ONCE — it is never exposed again after this.
 */
export async function ensureZohoWebhookIdentity(orgId: OrgId): Promise<ZohoWebhookIdentity> {
  const creds = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
  if (!creds) {
    throw new Error(`Zoho is not connected for org ${orgId}; cannot mint webhook identity.`);
  }
  if (creds.webhookToken && creds.webhookSecret) {
    return { webhookToken: creds.webhookToken, webhookSecret: creds.webhookSecret };
  }

  const identity: ZohoWebhookIdentity = {
    webhookToken: creds.webhookToken || mintToken(),
    webhookSecret: creds.webhookSecret || mintSecret(),
  };

  // Re-encrypt the merged payload and mirror the token to the indexed column in
  // one statement, preserving display_label/status/created_by (so we don't use
  // upsert, which would overwrite them).
  const merged: ZohoCredentials = { ...creds, ...identity };
  const enc = encryptIntegrationPayload(merged);
  await pool.query(
    `UPDATE organization_integrations
        SET payload_encrypted = $3,
            webhook_token      = $4,
            updated_at         = now()
      WHERE organization_id = $1
        AND provider = $2
        AND COALESCE(scope, '') = ''`,
    [orgId, 'zoho', enc, identity.webhookToken],
  );
  invalidateCredentialCache(orgId, 'zoho');
  return identity;
}

/**
 * Resolve the org that owns a webhook token. O(1) via the unique index on
 * organization_integrations.webhook_token. Only active Zoho connections match.
 */
export async function resolveOrgByWebhookToken(token: string): Promise<OrgId | null> {
  const clean = (token || '').trim();
  if (!clean) return null;
  const { rows } = await pool.query<{ organization_id: string }>(
    `SELECT organization_id
       FROM organization_integrations
      WHERE webhook_token = $1
        AND provider = 'zoho'
        AND status = 'active'
      LIMIT 1`,
    [clean],
  );
  return (rows[0]?.organization_id as OrgId | undefined) ?? null;
}
