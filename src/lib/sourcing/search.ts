import pool from '@/lib/db';
import { browseSearch, type BrowseCondition } from '@/lib/ebay/browse-client';
import { normalizeBrowseItems, type NormalizedCandidate } from '@/lib/sourcing/normalize';
import { saveCandidate } from '@/lib/neon/sourcing-queries';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Secondary-market sourcing search orchestration.
 *
 * Builds an eBay Browse query (prefers model number + part role keywords),
 * runs a single Browse call, normalizes the hits, logs the call to
 * ebay_api_calls, and — only when `save` is set — persists the hits as
 * sourcing_candidates (deduped on the (source, external_id) unique index).
 *
 * Quota discipline (Browse ~5k/day): this is user-initiated only, one round
 * trip per call, no auto-fan-out. Callers should short-cache identical queries
 * upstream.
 */

export interface SearchSecondaryMarketParams {
  query?: string | null;
  modelNumber?: string | null;
  partRole?: string | null;
  conditions?: BrowseCondition[];
  maxPriceCents?: number | null;
  limit?: number;
  /** Persist hits as candidates (watchlist) against this context. */
  save?: boolean;
  skuId?: number | null;
  boseModelId?: number | null;
  sourcingAlertId?: number | null;
  orgId?: OrgId;
}

export interface SearchSecondaryMarketResult {
  query: string;
  results: NormalizedCandidate[];
  total: number;
  saved: number;
}

/** Build the Browse `q` from the most specific signal available. */
function buildQuery(params: SearchSecondaryMarketParams): string {
  const parts: string[] = [];
  if (params.modelNumber?.trim()) parts.push(params.modelNumber.trim());
  if (params.partRole?.trim()) parts.push(params.partRole.trim().replace(/_/g, ' '));
  if (params.query?.trim()) parts.push(params.query.trim());
  return parts.join(' ').trim();
}

async function logCall(endpoint: string, latencyMs: number, statusCode: number, errorMessage: string | null) {
  try {
    await pool.query(
      `INSERT INTO ebay_api_calls (method, endpoint, latency_ms, status_code, error_message, created_at)
       VALUES ('GET', $1, $2, $3, $4, NOW())`,
      [endpoint, latencyMs, statusCode, errorMessage],
    );
  } catch (err) {
    console.warn('[sourcing.search] ebay_api_calls log failed:', err instanceof Error ? err.message : err);
  }
}

export async function searchSecondaryMarket(
  params: SearchSecondaryMarketParams,
): Promise<SearchSecondaryMarketResult> {
  const q = buildQuery(params);
  if (!q) throw new Error('Provide a query or modelNumber to search');

  const startedAt = Date.now();
  let normalized: NormalizedCandidate[];
  let total = 0;
  try {
    const browse = await browseSearch({
      q,
      conditions: params.conditions,
      maxPriceCents: params.maxPriceCents ?? null,
      limit: params.limit,
      orgId: params.orgId,
    });
    normalized = normalizeBrowseItems(browse.items);
    total = browse.total;
    await logCall('buy/browse/v1/item_summary/search', Date.now() - startedAt, 200, null);
  } catch (err) {
    await logCall(
      'buy/browse/v1/item_summary/search',
      Date.now() - startedAt,
      502,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }

  // Persist to the watchlist only when explicitly requested.
  let saved = 0;
  if (params.save && normalized.length) {
    for (const n of normalized) {
      try {
        await saveCandidate({
          source: 'ebay',
          externalId: n.externalId,
          title: n.title,
          url: n.url,
          imageUrl: n.imageUrl,
          condition: n.condition,
          priceCents: n.priceCents,
          shippingCents: n.shippingCents,
          currency: n.currency,
          sellerName: n.sellerName,
          skuId: params.skuId ?? null,
          boseModelId: params.boseModelId ?? null,
          sourcingAlertId: params.sourcingAlertId ?? null,
          status: 'watching',
          raw: n.raw,
        });
        saved += 1;
      } catch (err) {
        console.warn('[sourcing.search] saveCandidate failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  return { query: q, results: normalized, total, saved };
}
