/**
 * POST /api/receiving/visual-identify
 *
 * Enrich ranked SKU candidates produced by the LAN vision box (the RTX 5070 Ti) —
 * see vision/ and src/lib/vision-identify.ts. The browser posts the captured frame
 * straight to the box (the full-res image never reaches Vercel) and forwards the
 * resulting [{ sku, score }] here so we can resolve each against sku_catalog for
 * display + pairing.
 *
 * Read-only: this only looks up catalog rows. The actual pairing reuses the existing
 * idempotent /api/receiving/add-unmatched-line (unfound cartons) or a line PATCH —
 * so there's no mutation here and no idempotency key needed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getSkuCatalogBySku,
  type SkuCatalogRow,
} from '@/lib/neon/sku-catalog-queries';

interface RawCandidate {
  sku: string;
  score: number;
}

interface EnrichedCandidate extends RawCandidate {
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  resolved: boolean;
}

// Cap how many candidates we resolve so a malformed payload can't fan out into an
// unbounded number of catalog lookups.
const MAX_CANDIDATES = 10;

function parseCandidates(raw: unknown): RawCandidate[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RawCandidate[] = [];
  for (const item of raw.slice(0, MAX_CANDIDATES)) {
    if (!item || typeof item !== 'object') continue;
    const sku = String((item as Record<string, unknown>).sku ?? '').trim();
    const score = Number((item as Record<string, unknown>).score);
    if (!sku) continue;
    out.push({ sku, score: Number.isFinite(score) ? score : 0 });
  }
  return out;
}

export const POST = withAuth(
  async (request: NextRequest) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
    }

    const receivingId = Number(body.receiving_id);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_id is required' },
        { status: 400 },
      );
    }

    const candidates = parseCandidates(body.candidates);
    if (!candidates) {
      return NextResponse.json(
        { success: false, error: 'candidates must be an array of { sku, score }' },
        { status: 400 },
      );
    }

    // Resolve each distinct SKU once, then map back preserving order/score.
    const distinct = [...new Set(candidates.map((c) => c.sku))];
    const rows = await Promise.all(distinct.map((sku) => getSkuCatalogBySku(sku)));
    const bySku = new Map<string, SkuCatalogRow | null>();
    distinct.forEach((sku, i) => bySku.set(sku, rows[i]));

    const enriched: EnrichedCandidate[] = candidates.map((c) => {
      const row = bySku.get(c.sku) ?? null;
      return {
        sku: c.sku,
        score: c.score,
        sku_catalog_id: row?.id ?? null,
        product_title: row?.product_title ?? null,
        image_url: row?.image_url ?? null,
        resolved: row != null,
      };
    });

    return NextResponse.json({ success: true, candidates: enriched });
  },
  { permission: 'receiving.view' },
);
