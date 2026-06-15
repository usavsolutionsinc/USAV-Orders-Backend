/**
 * Pure Zoho Inventory URL + data-center helpers.
 *
 * Deliberately free of app dependencies (no DB, no '@/' imports) so it is unit
 * testable in isolation under `tsx --test`. core.ts re-exports these and feeds
 * them the tenant's ZohoCredentials (which structurally satisfies ZohoUrlConfig).
 */

export interface ZohoUrlConfig {
  /** The TENANT'S Zoho Inventory organization_id (goes in the query string). */
  orgId: string;
  /** Accounts data-center domain, e.g. 'accounts.zoho.eu'. Defaults to .com. */
  domain?: string;
}

export function accountsDomain(cfg: { domain?: string }): string {
  const d = (cfg.domain ?? '').trim();
  return d || 'accounts.zoho.com';
}

/** Inventory API root for the connection's data center. */
export function getInventoryBaseUrl(cfg: ZohoUrlConfig): string {
  const d = accountsDomain(cfg);
  if (d.includes('.eu')) return 'https://www.zohoapis.eu/inventory/v1';
  if (d.includes('.in')) return 'https://www.zohoapis.in/inventory/v1';
  if (d.includes('.com.au')) return 'https://www.zohoapis.com.au/inventory/v1';
  if (d.includes('.ca')) return 'https://www.zohoapis.ca/inventory/v1';
  if (d.includes('.jp')) return 'https://www.zohoapis.jp/inventory/v1';
  return 'https://www.zohoapis.com/inventory/v1';
}

/**
 * Build a fully-qualified Inventory URL. `organization_id` is always the
 * tenant's Zoho org id (cfg.orgId). A leading `/api/v1` (legacy path style) is
 * stripped; empty/null/undefined query values are omitted.
 */
export function buildZohoUrl(
  path: string,
  query: Record<string, string | number | boolean | null | undefined>,
  cfg: ZohoUrlConfig,
): string {
  const params = new URLSearchParams({ organization_id: cfg.orgId });

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });

  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('/api/v1')) {
    normalizedPath = normalizedPath.slice('/api/v1'.length) || '/';
  }

  return `${getInventoryBaseUrl(cfg)}${normalizedPath}?${params.toString()}`;
}
