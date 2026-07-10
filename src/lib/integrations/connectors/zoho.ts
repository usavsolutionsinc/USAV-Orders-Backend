/**
 * Zoho connector validate adapter (INT-011) — thin adapter over the
 * /api/zoho/health check logic: resolve this org's Zoho credentials from the
 * vault (env bridge for the dogfood org) and confirm the stored refresh token
 * still mints an access token. Lazily imported by the registry so the
 * lightweight connection reader never pulls in the Zoho client.
 */
import type { OrgId } from '@/lib/tenancy/constants';
import { getAccessToken, loadZohoCredentials, ZohoNotConnectedError } from '@/lib/zoho/core';
import { withZohoOrg } from '@/lib/zoho/tenant-context';
import type { HealthResult } from './types';

export async function zohoValidate(orgId: OrgId): Promise<HealthResult> {
  // 1. Is there a usable connection for this tenant?
  let connection: { zohoOrganizationId: string; dataCenter: string };
  try {
    const creds = await loadZohoCredentials(orgId);
    connection = {
      zohoOrganizationId: creds.orgId,
      dataCenter: creds.domain || 'accounts.zoho.com',
    };
  } catch (err) {
    if (err instanceof ZohoNotConnectedError) {
      return { ok: false, error: 'No Zoho connection for this organization.' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to load Zoho credentials' };
  }

  // 2. Live check — the stored refresh token still mints an access token.
  try {
    const token = await withZohoOrg(orgId, () => getAccessToken(orgId));
    if (!token) return { ok: false, error: 'Token mint returned empty.', detail: { connection } };
    return { ok: true, detail: { connection } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Token mint failed',
      detail: { connection },
    };
  }
}
