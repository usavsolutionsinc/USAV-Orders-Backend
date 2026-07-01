/**
 * NAS upload target for manual outbound-document attach (labels + slips).
 * Shared by src/app/api/orders/[id]/documents/route.ts (GET) and the
 * deprecated src/app/api/order-labels/route.ts (GET) so both surfaces the
 * same base URL / folder to the browser-direct WebDAV PUT flow.
 */

import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl, getNasStorageTarget } from '@/lib/tenancy/settings';
import { resolveOperatorNasFolder } from '@/lib/nas-photos-server';
import type { OrgId } from '@/lib/tenancy/constants';

export interface OutboundNasTarget {
  /** '' = NAS not configured for this org (client should fall back to a manual URL or disable upload). */
  nasBaseUrl: string;
  nasFolder: string;
}

export async function resolveOutboundNasTarget(orgId: OrgId, staffId: number): Promise<OutboundNasTarget> {
  let nasBaseUrl = '';
  let nasFolder = '';
  try {
    const [org, folder] = await Promise.all([
      getOrganization(orgId),
      resolveOperatorNasFolder(orgId, staffId),
    ]);
    nasFolder = org ? getNasStorageTarget(org.settings, 'shipping').folder || folder : folder;
    nasBaseUrl = process.env.NAS_AGENT_URL
      ? '/api/nas-target/shipping'
      : org ? getActiveNasBaseUrl(org.settings) : '';
  } catch {
    nasBaseUrl = '';
    nasFolder = '';
  }
  if (!nasBaseUrl) {
    const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
    if (envBase && !envBase.startsWith('/')) nasBaseUrl = envBase;
  }
  return { nasBaseUrl, nasFolder };
}
