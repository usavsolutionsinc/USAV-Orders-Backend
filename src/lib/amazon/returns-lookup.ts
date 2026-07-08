/**
 * Amazon External Fulfillment Returns lookup — match an inbound return package to
 * its Amazon return record by reverse (carrier) tracking id.
 *
 * Thin wrapper over `callSpApi` (house no-SDK pattern, cf. order-sync.ts). Uses
 * the External Fulfillment Returns API `listReturns` with its `reverseTrackingId`
 * filter, then `getReturn` for the full payload:
 *   GET /externalFulfillment/returns/2021-08-19/returns?reverseTrackingId=…
 *   GET /externalFulfillment/returns/2021-08-19/returns/{returnId}
 * (docs: developerdocs.smartconnect.amazon.com/returnsUseCaseGuide.html)
 *
 * AVAILABILITY — this API is gated on enrollment in Amazon External Fulfillment
 * (Seller Flex). A connection without that authorization gets an SP-API 401/403;
 * we classify that as UNSUPPORTED (not a hard error) so the UI can say "Amazon
 * Returns access is not enabled for this connection" rather than failing. There
 * is no other SP-API surface that resolves an arbitrary inbound return package by
 * its carrier tracking for a standard seller, so unsupported is the honest state
 * for a non-Seller-Flex org.
 *
 * Deps-injected (backend-patterns.md) so unit tests run with zero DB / network.
 */

import type { AmazonCredentials } from '@/lib/integrations/credentials';
import { callSpApi, type AmazonAccount } from './client';
import { loadActiveAmazonAccounts, loadAmazonCreds } from './accounts';

/** External Fulfillment Returns API version (path segment). */
const RETURNS_API_VERSION = '2021-08-19';

/** Normalized return facts the route + UI consume. */
export interface AmazonReturnMatch {
  accountName: string;
  returnId: string;
  rmaId: string | null;
  customerOrderId: string | null;
  merchantSku: string | null;
  channelSku: string | null;
  reverseTrackingId: string | null;
  carrierName: string | null;
  status: string | null;
}

export interface AmazonReturnLookupResult {
  matched: boolean;
  /** True when NO connected account could query returns (not enrolled / no creds). */
  unsupported: boolean;
  match: AmazonReturnMatch | null;
  /** Short human reason for the no-match / unsupported case. */
  reason?: string;
}

// ── Raw SP-API shapes (subset we read; unknown fields tolerated) ───────────────
interface RawReturnItem {
  returnId?: string;
  id?: string;
  status?: string;
  returnMetadata?: { rmaId?: string | null } | null;
  marketplaceChannelDetails?: { customerOrderId?: string | null } | null;
  reverseTrackingInfo?: { trackingId?: string | null; carrierName?: string | null } | null;
  merchantSku?: string | null;
  channelSku?: string | null;
  [k: string]: unknown;
}
interface ListReturnsResponse {
  returns?: RawReturnItem[];
  payload?: { returns?: RawReturnItem[] };
  [k: string]: unknown;
}

/**
 * An SP-API failure that means "this connection can't call the Returns API"
 * (missing External Fulfillment authorization) rather than a transient error.
 * `callSpApi` throws a plain Error with the HTTP status in its message, so we
 * classify by status token / access-denied language.
 */
function isUnsupportedSpApiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('http 401') ||
    msg.includes('http 403') ||
    msg.includes('unauthorized') ||
    msg.includes('access to requested resource is denied') ||
    msg.includes('access denied')
  );
}

function returnIdOf(item: RawReturnItem): string | null {
  const id = item.returnId ?? item.id;
  return id ? String(id) : null;
}

function toMatch(accountName: string, item: RawReturnItem): AmazonReturnMatch {
  return {
    accountName,
    returnId: returnIdOf(item) ?? '',
    rmaId: item.returnMetadata?.rmaId ?? null,
    customerOrderId: item.marketplaceChannelDetails?.customerOrderId ?? null,
    merchantSku: item.merchantSku ?? null,
    channelSku: item.channelSku ?? null,
    reverseTrackingId: item.reverseTrackingInfo?.trackingId ?? null,
    carrierName: item.reverseTrackingInfo?.carrierName ?? null,
    status: item.status ?? null,
  };
}

function itemsOf(data: ListReturnsResponse | RawReturnItem): RawReturnItem[] {
  const d = data as ListReturnsResponse;
  if (Array.isArray(d.returns)) return d.returns;
  if (Array.isArray(d.payload?.returns)) return d.payload!.returns!;
  return [];
}

/** Injectable collaborators — real impls by default; fakes in tests. */
export interface ReturnsLookupDeps {
  loadAccounts: (orgId: string) => Promise<AmazonAccount[]>;
  loadCreds: (orgId: string, account: AmazonAccount) => Promise<AmazonCredentials | null>;
  callApi: typeof callSpApi;
}

const defaultDeps: ReturnsLookupDeps = {
  loadAccounts: loadActiveAmazonAccounts,
  loadCreds: loadAmazonCreds,
  callApi: callSpApi,
};

/**
 * Look up an Amazon return across the org's connected accounts by reverse
 * (carrier) tracking id. Returns the first match, else no-match. If EVERY
 * connected account is unauthorized for the Returns API (or has no creds), the
 * result is `unsupported` (the org isn't on External Fulfillment / Seller Flex).
 */
export async function lookupAmazonReturnByTracking(
  orgId: string,
  reverseTrackingId: string,
  deps: ReturnsLookupDeps = defaultDeps,
): Promise<AmazonReturnLookupResult> {
  const tracking = reverseTrackingId.trim();
  if (!tracking) {
    return { matched: false, unsupported: false, match: null, reason: 'No tracking number' };
  }

  const accounts = await deps.loadAccounts(orgId);
  if (accounts.length === 0) {
    return { matched: false, unsupported: true, match: null, reason: 'No Amazon account connected' };
  }

  let anyQueryable = false;
  for (const account of accounts) {
    const creds = await deps.loadCreds(orgId, account);
    if (!creds) continue;
    try {
      const data = await deps.callApi<ListReturnsResponse>(account, creds, {
        operation: 'listReturns',
        path: `/externalFulfillment/returns/${RETURNS_API_VERSION}/returns`,
        query: { reverseTrackingId: tracking, maxResults: 20 },
      });
      anyQueryable = true;
      const items = itemsOf(data);
      if (items.length === 0) continue;

      // Prefer the full getReturn payload; fall back to the list item on failure.
      const first = items[0]!;
      const returnId = returnIdOf(first);
      let full: RawReturnItem = first;
      if (returnId) {
        try {
          const detail = await deps.callApi<RawReturnItem | { payload?: RawReturnItem }>(
            account,
            creds,
            {
              operation: 'getReturn',
              path: `/externalFulfillment/returns/${RETURNS_API_VERSION}/returns/${encodeURIComponent(returnId)}`,
            },
          );
          full = (detail as { payload?: RawReturnItem })?.payload ?? (detail as RawReturnItem) ?? first;
        } catch {
          /* keep the list item — it already carries the fields we need */
        }
      }
      return { matched: true, unsupported: false, match: toMatch(account.accountName, full) };
    } catch (err) {
      // Not enrolled / unauthorized for this account — try the next one.
      if (isUnsupportedSpApiError(err)) continue;
      // A genuine transient/unknown error: let the caller decide (route → 502).
      throw err;
    }
  }

  if (!anyQueryable) {
    return {
      matched: false,
      unsupported: true,
      match: null,
      reason: 'Amazon Returns API is not enabled for this connection',
    };
  }
  return { matched: false, unsupported: false, match: null, reason: 'No matching Amazon return' };
}
