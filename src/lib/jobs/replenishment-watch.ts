import pool from '@/lib/db';
import { searchSecondaryMarket } from '@/lib/sourcing/search';
import { saveCandidate } from '@/lib/neon/sourcing-queries';

/**
 * Replenish watcher — the active half of auto-replenish.
 *
 * For every SKU that has a live `replenish` sourcing_alert (enrolled at pack-out
 * by trg_replenish_on_sold) AND a `replenish_target_cents` price point set, run
 * one eBay Browse search. If a listing's landed price (item + shipping) is at or
 * below the target, save the cheapest hits as watchlist candidates and escalate
 * the replenish alert to critical with a "found at $X ≤ target $Z" reason.
 *
 * Idempotent: candidates dedupe on (source, external_id); the alert escalation
 * is a plain UPDATE. Quota-friendly: one Browse call per due SKU per run.
 */

interface DueReplenishment {
  alert_id: number;
  sku_id: number;
  product_title: string;
  target_cents: number;
}

export interface ReplenishWatchResult {
  checked: number;
  dealsFound: number;
  candidatesSaved: number;
}

async function getDueReplenishments(): Promise<DueReplenishment[]> {
  const r = await pool.query<DueReplenishment>(
    `SELECT sa.id AS alert_id, sc.id AS sku_id, sc.product_title, sc.replenish_target_cents AS target_cents
       FROM sourcing_alerts sa
       JOIN sku_catalog sc ON sc.id = sa.sku_id
      WHERE sa.alert_type = 'replenish'
        AND sa.status IN ('open','sourcing')
        AND sc.replenish_target_cents IS NOT NULL
      ORDER BY sa.opened_at ASC`,
  );
  return r.rows;
}

const landed = (priceCents: number | null, shippingCents: number | null): number | null =>
  priceCents == null ? null : priceCents + (shippingCents ?? 0);

export async function runReplenishmentWatch(): Promise<ReplenishWatchResult> {
  const due = await getDueReplenishments();
  let dealsFound = 0;
  let candidatesSaved = 0;

  for (const d of due) {
    try {
      const { results } = await searchSecondaryMarket({
        query: d.product_title,
        skuId: d.sku_id,
        sourcingAlertId: d.alert_id,
        maxPriceCents: d.target_cents, // pre-filter at the Browse query
        limit: 20,
        save: false,
      });

      const below = results
        .map((r) => ({ r, landed: landed(r.priceCents, r.shippingCents) }))
        .filter((x): x is { r: (typeof results)[number]; landed: number } => x.landed != null && x.landed <= d.target_cents)
        .sort((a, b) => a.landed - b.landed);

      if (below.length === 0) continue;
      dealsFound += 1;

      for (const { r } of below.slice(0, 5)) {
        const { created } = await saveCandidate({
          source: 'ebay',
          externalId: r.externalId,
          title: r.title,
          url: r.url,
          imageUrl: r.imageUrl,
          condition: r.condition,
          priceCents: r.priceCents,
          shippingCents: r.shippingCents,
          currency: r.currency,
          sellerName: r.sellerName,
          skuId: d.sku_id,
          sourcingAlertId: d.alert_id,
          status: 'watching',
          raw: r.raw,
        });
        if (created) candidatesSaved += 1;
      }

      const best = below[0].landed;
      const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
      await pool.query(
        `UPDATE sourcing_alerts
            SET severity = 'critical',
                reason = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [d.alert_id, `Found at ${fmt(best)} ≤ target ${fmt(d.target_cents)} (${below.length} listing${below.length === 1 ? '' : 's'})`],
      );
    } catch (err) {
      console.warn('[replenish.watch] failed for sku', d.sku_id, err instanceof Error ? err.message : err);
    }
  }

  return { checked: due.length, dealsFound, candidatesSaved };
}
