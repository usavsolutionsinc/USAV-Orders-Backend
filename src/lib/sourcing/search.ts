import type { BrowseCondition } from '@/lib/ebay/browse-client';
import { saveCandidate } from '@/lib/neon/sourcing-queries';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';
import type { CandidateSource, NormalizedCandidate } from '@/lib/sourcing/normalize';
import { buildScourQuery, type ScourRequest } from './adapters/types';
import { getEnabledAdapters } from './adapters';

/**
 * Secondary-market sourcing orchestration (the "scour").
 *
 * Builds one query from the most specific signal available, fans it across every
 * *enabled* SourceAdapter (eBay today; see src/lib/sourcing/adapters), dedupes
 * the hits, and — only when `save` is set — persists them as sourcing_candidates
 * (deduped on the (source, external_id) unique index).
 *
 * Resilience: adapters run with allSettled, so one failing channel doesn't sink
 * the others. If *every* adapter fails (e.g. the sole eBay channel errors on
 * creds), the first error is rethrown so the caller can surface it (502).
 *
 * Quota discipline: each adapter does one round trip per call and logs its own
 * usage. Callers keep this user-initiated and short-cache identical queries.
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
  /** Restrict the scour to specific channels (default: all enabled). */
  sources?: CandidateSource[];
}

export interface SearchSecondaryMarketResult {
  query: string;
  results: NormalizedCandidate[];
  total: number;
  saved: number;
  /** Per-channel hit counts (before cross-channel dedupe). */
  bySource: Record<string, number>;
}

export async function scour(
  params: SearchSecondaryMarketParams,
): Promise<SearchSecondaryMarketResult> {
  const orgId = params.orgId ?? USAV_ORG_ID;
  const req: ScourRequest = {
    query: params.query ?? null,
    modelNumber: params.modelNumber ?? null,
    partRole: params.partRole ?? null,
    conditions: params.conditions,
    maxPriceCents: params.maxPriceCents ?? null,
    limit: params.limit,
    orgId,
  };

  const q = buildScourQuery(req);
  if (!q) throw new Error('Provide a query or modelNumber to search');

  const adapters = await getEnabledAdapters(orgId, params.sources);
  if (adapters.length === 0) {
    throw new Error('No sourcing channels are configured for this organization');
  }

  const settled = await Promise.allSettled(adapters.map((a) => a.search(req)));
  const all: NormalizedCandidate[] = [];
  const bySource: Record<string, number> = {};
  const errors: unknown[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      all.push(...s.value);
      bySource[adapters[i].id] = s.value.length;
    } else {
      errors.push(s.reason);
    }
  });
  // Every channel failed → surface the first error (preserves single-channel 502).
  if (all.length === 0 && errors.length > 0) {
    throw errors[0];
  }

  // Dedupe across channels: prefer the external id, else title+price.
  const seen = new Set<string>();
  const results = all.filter((n) => {
    const key = `${n.source}:${n.externalId ?? `${n.title}|${n.priceCents}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let saved = 0;
  if (params.save && results.length) {
    for (const n of results) {
      try {
        await saveCandidate({
          source: n.source,
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
        console.warn('[sourcing.scour] saveCandidate failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  return { query: q, results, total: results.length, saved, bySource };
}

/** Back-compat alias — the orchestrator was previously named searchSecondaryMarket. */
export const searchSecondaryMarket = scour;
