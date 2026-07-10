/**
 * eBay OAuth configuration — the single source of truth for scopes, the
 * sandbox/production environment, and the matching eBay endpoints.
 *
 * Before this module the scope set and the token endpoint were duplicated and
 * had DRIFTED across the codebase:
 *   - /api/ebay/connect requested api_scope + sell.fulfillment + sell.inventory
 *     + sell.marketing + sell.account, and treated a missing EBAY_ENVIRONMENT
 *     as SANDBOX.
 *   - src/lib/ebay/token-refresh.ts hardcoded the PRODUCTION token endpoint and
 *     a narrower 3-scope set (api_scope + sell.inventory + sell.fulfillment).
 * A refresh requesting fewer scopes than consent silently downgrades the token,
 * and a sandbox tenant refreshing against the production endpoint just fails.
 *
 * Everything that builds an authorize URL, exchanges a code, or refreshes a
 * token now resolves scopes + endpoints from here so consent and refresh always
 * agree. The scope set is overridable via EBAY_SCOPES (space-separated) so we
 * never have to redeploy code to add/remove a scope the eBay app is approved for.
 */
import { normalizeEnvValue } from '@/lib/env-utils';

export type EbayEnvironment = 'PRODUCTION' | 'SANDBOX';

/**
 * The role an eBay OAuth connection plays. This is THE difference between a
 * selling account and a purchasing account: same eBay OAuth app, different scope
 * set + a discriminator persisted on ebay_accounts.account_role. Buyer tokens
 * feed Universal Incoming (purchases → receiving_lines); seller tokens feed the
 * existing outbound fulfillment/reconcile path.
 */
export type EbayAccountRole = 'seller' | 'buyer';

/** Coerce an arbitrary value to a valid role; anything but 'buyer' is 'seller'. */
export function normalizeEbayRole(value?: string | null): EbayAccountRole {
  return String(value ?? '').trim().toLowerCase() === 'buyer' ? 'buyer' : 'seller';
}

/** httpOnly cookie that carries the single-use CSRF nonce across the OAuth redirect. */
export const EBAY_OAUTH_STATE_COOKIE = 'ebay_oauth_state';

/**
 * Minimal seller-copilot scope set. `sell.finances` is intentionally NOT
 * included by default — it requires separate eBay app approval and requesting
 * an unapproved scope fails consent. Add it (or any other approved scope) via
 * the EBAY_SCOPES env var when the app is granted it.
 */
const DEFAULT_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
];

/**
 * Minimal buyer (purchasing) scope set.
 *
 * - `api_scope` — base user token. Trading API GetOrders (OrderRole=Buyer) for
 *   purchase *discovery* authorizes via the IAF header and does **not** require
 *   an extra OAuth scope beyond this base scope (traditional APIs ignore scopes).
 * - `buy.order.readonly` — RESTRICTED; required for Buy Order
 *   GET /buy/order/v1/purchase_order/{id} enrich. Needs eBay business approval;
 *   requesting it unapproved fails consent. Override via EBAY_BUYER_SCOPES
 *   (space-separated) to drop it until approved, or to add further scopes.
 *
 * Re-consent buyer accounts after changing this set so refresh keeps matching
 * consent (a narrower refresh silently downgrades the token).
 */
const DEFAULT_BUYER_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/buy.order.readonly',
];

/** The exact SELLER scope list requested at consent AND on refresh — keep them equal. */
export function ebayScopes(): string[] {
  const raw = normalizeEnvValue(process.env.EBAY_SCOPES);
  if (raw) {
    const parsed = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [...DEFAULT_SCOPES];
}

/** The exact BUYER (purchasing) scope list — overridable via EBAY_BUYER_SCOPES. */
export function ebayBuyerScopes(): string[] {
  const raw = normalizeEnvValue(process.env.EBAY_BUYER_SCOPES);
  if (raw) {
    const parsed = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [...DEFAULT_BUYER_SCOPES];
}

/** Role-aware scope list — buyer vs seller consent/refresh must use its OWN set. */
export function ebayScopesForRole(role: EbayAccountRole): string[] {
  return role === 'buyer' ? ebayBuyerScopes() : ebayScopes();
}

/** Space-separated SELLER scope string (URL-encode at the call site). */
export function ebayScopeString(): string {
  return ebayScopes().join(' ');
}

/** Space-separated BUYER scope string (URL-encode at the call site). */
export function ebayBuyerScopeString(): string {
  return ebayBuyerScopes().join(' ');
}

/**
 * Space-separated scope string for a role. The consent request AND every later
 * refresh for an account MUST use the SAME role's set — refreshing a buyer token
 * with the seller set silently downgrades its scopes (the plan's scope-downgrade
 * risk). Callers resolve the account's role and pass it here on both paths.
 */
export function ebayScopeStringForRole(role: EbayAccountRole): string {
  return ebayScopesForRole(role).join(' ');
}

/**
 * Normalize an environment value. Default is PRODUCTION when unset — this is the
 * canonical interpretation (USAV runs production, credentials.ts already
 * defaults to PRODUCTION, and the old token-refresh path hardcoded production).
 * SANDBOX is opt-in via an explicit 'SANDBOX' value.
 */
export function normalizeEbayEnvironment(value?: string | null): EbayEnvironment {
  return String(value ?? '').trim().toUpperCase() === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
}

export function isEbaySandbox(env?: string | null): boolean {
  return normalizeEbayEnvironment(env) === 'SANDBOX';
}

/** Consent (authorize) host, environment-aware. */
export function ebayAuthDomain(env?: string | null): string {
  return isEbaySandbox(env) ? 'auth.sandbox.ebay.com' : 'auth.ebay.com';
}

/** OAuth2 token endpoint, environment-aware. */
export function ebayTokenEndpoint(env?: string | null): string {
  return isEbaySandbox(env)
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';
}

/** Commerce Identity (getUser) endpoint, environment-aware. */
export function ebayIdentityEndpoint(env?: string | null): string {
  return isEbaySandbox(env)
    ? 'https://api.sandbox.ebay.com/commerce/identity/v1/user/'
    : 'https://api.ebay.com/commerce/identity/v1/user/';
}
