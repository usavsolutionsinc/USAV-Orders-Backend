import type { BrowseItemSummary } from '@/lib/ebay/browse-client';

/**
 * The set of secondary-market channels a candidate can come from. eBay is the
 * only one wired today; the rest are reserved for additional SourceAdapters
 * (Sourcing Hub plan §4.1). NOTE: the sourcing_candidates.source CHECK still
 * only allows 'ebay'|'manual' — widen it (a migration) before enabling a new
 * channel that persists candidates.
 */
export type CandidateSource =
  | 'ebay'
  | 'amazon'
  | 'google_shopping'
  | 'zoho_po'
  | 'distributor'
  | 'manual';

/**
 * Normalized secondary-market hit — the shape the sourcing UI renders and that
 * maps 1:1 onto a sourcing_candidates row (see saveCandidate). Money is in
 * integer cents to match the schema; `raw` carries the full source payload.
 */
export interface NormalizedCandidate {
  source: CandidateSource;
  externalId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  condition: 'new' | 'refurbished' | 'used' | 'for_parts' | null;
  priceCents: number | null;
  shippingCents: number | null;
  currency: string;
  sellerName: string | null;
  raw: unknown;
}

/** eBay conditionId → our condition enum. */
function mapConditionId(conditionId: string | undefined, conditionText: string | undefined): NormalizedCandidate['condition'] {
  const id = (conditionId || '').trim();
  if (id === '1000') return 'new';
  if (['2000', '2010', '2020', '2030', '2500'].includes(id)) return 'refurbished';
  if (['3000', '4000', '5000', '6000'].includes(id)) return 'used';
  if (id === '7000') return 'for_parts';

  const text = (conditionText || '').toLowerCase();
  if (!text) return null;
  if (text.includes('for parts') || text.includes('not working')) return 'for_parts';
  if (text.includes('refurbished') || text.includes('renewed')) return 'refurbished';
  if (text.includes('new')) return 'new';
  if (text.includes('used') || text.includes('pre-owned') || text.includes('good') || text.includes('acceptable')) return 'used';
  return null;
}

function toCents(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Normalize one eBay Browse item summary into a candidate. */
export function normalizeBrowseItem(item: BrowseItemSummary): NormalizedCandidate {
  const externalId = (item.itemId || item.legacyItemId || '').trim() || null;
  const imageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null;
  const shippingCost = item.shippingOptions?.[0]?.shippingCost?.value;

  return {
    source: 'ebay',
    externalId,
    title: (item.title || 'Untitled listing').trim(),
    url: item.itemWebUrl || null,
    imageUrl,
    condition: mapConditionId(item.conditionId, item.condition),
    priceCents: toCents(item.price?.value),
    shippingCents: toCents(shippingCost),
    currency: item.price?.currency || 'USD',
    sellerName: item.seller?.username || null,
    raw: item,
  };
}

/** Normalize a page of Browse results, de-duped by externalId. */
export function normalizeBrowseItems(items: BrowseItemSummary[]): NormalizedCandidate[] {
  const seen = new Set<string>();
  const out: NormalizedCandidate[] = [];
  for (const item of items) {
    const n = normalizeBrowseItem(item);
    const key = n.externalId ?? `${n.title}|${n.priceCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
