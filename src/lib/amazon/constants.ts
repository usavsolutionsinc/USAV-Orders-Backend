/**
 * Amazon SP-API constants — regional hosts, OAuth/consent hosts, marketplace IDs.
 *
 * SP-API is LWA-only since 2023-10-02 (no AWS IAM/SigV4). We call the regional
 * API host with an `x-amz-access-token` header. See
 * docs/amazon-sp-api-order-import-plan.md.
 */

export type AmazonRegion = 'NA' | 'EU' | 'FE';

/** Login-with-Amazon token endpoint (global). */
export const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Regional SP-API base hosts. India is served by EU, not FE. */
export const SP_API_HOSTS: Record<AmazonRegion, string> = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
};

/**
 * Seller Central consent hosts for the OAuth authorization-code (website)
 * flow. The owner is redirected here to grant the app access; Amazon then
 * redirects back to our callback with `spapi_oauth_code` + `selling_partner_id`.
 */
export const SELLERCENTRAL_HOSTS: Record<AmazonRegion, string> = {
  NA: 'https://sellercentral.amazon.com',
  EU: 'https://sellercentral-europe.amazon.com',
  FE: 'https://sellercentral.amazon.co.jp',
};

/** Common marketplace IDs keyed by country (extend as needed). */
export const MARKETPLACE_IDS = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
  BR: 'A2Q3Y263D00KWC',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  NL: 'A1805IZSGTT6HS',
  IN: 'A21TJRUUN4KGV',
  JP: 'A1VC38T7YXB528',
  AU: 'A39IBJ37TRP1C6',
} as const;

export const DEFAULT_MARKETPLACE_ID = MARKETPLACE_IDS.US;

export function isAmazonRegion(value: unknown): value is AmazonRegion {
  return value === 'NA' || value === 'EU' || value === 'FE';
}
