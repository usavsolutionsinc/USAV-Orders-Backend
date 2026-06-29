import { scour } from '@/lib/sourcing/search';
import { getDueSourcingSearches, markSourcingSearchRun } from '@/lib/neon/sourcing-searches-queries';
import type { CandidateSource } from '@/lib/sourcing/normalize';
import type { BrowseCondition } from '@/lib/ebay/browse-client';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Scour watcher — the active half of standing searches (Sourcing Hub §4.3).
 *
 * Runs every due saved search (active, scheduled, past its cadence window) with
 * one scour each, saving the hits to the watchlist linked to the search's
 * sku/alert. Quota-friendly: one scour per due search per run; each scour is one
 * call per enabled adapter. last_run_at advances only on success, so a transient
 * failure is retried on the next tick rather than silently skipped.
 *
 * Distinct from runReplenishmentWatch (per-SKU replenish price-point watcher);
 * both are "scour watchers" but keyed on different sources.
 */

export interface ScourWatchResult {
  checked: number;
  withHits: number;
  candidatesSaved: number;
}

/**
 * Run the scour watcher for ONE org (or the legacy global pass when `orgId` is
 * omitted). The cron fans this out per eBay-connected org via
 * forEachOrgWithProvider('ebay', …) so each org's due searches are read,
 * scoured, and marked under THAT org's GUC + eBay credentials — never a global
 * USAV-cred pass over every tenant's searches. `getDueSourcingSearches`,
 * `scour`, and `markSourcingSearchRun` all org-scope when given an orgId.
 */
export async function runScourWatch(orgId?: OrgId): Promise<ScourWatchResult> {
  const due = await getDueSourcingSearches(orgId);
  let withHits = 0;
  let candidatesSaved = 0;

  for (const s of due) {
    try {
      const { results, saved } = await scour({
        query: s.query,
        skuId: s.sku_id,
        sourcingAlertId: s.sourcing_alert_id,
        conditions: (s.conditions ?? undefined) as BrowseCondition[] | undefined,
        maxPriceCents: s.max_price_cents,
        sources: (s.sources ?? undefined) as CandidateSource[] | undefined,
        limit: 20,
        save: true,
        orgId,
      });
      candidatesSaved += saved;
      if (results.length) withHits += 1;
      await markSourcingSearchRun(s.id, results.length, orgId);
    } catch (err) {
      // Leave last_run_at untouched so the next tick retries.
      console.warn('[scour.watch] failed for search', s.id, err instanceof Error ? err.message : err);
    }
  }

  return { checked: due.length, withHits, candidatesSaved };
}
