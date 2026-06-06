import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { findPendingOrderSkuMatches } from '@/lib/receiving/pending-order-match';

/**
 * Read-only triage verdict for a scanned carton/line.
 *
 * Given a line's SKU(s) and/or Zoho item id(s), returns whether any resolve —
 * directly or through the platform-pairing bridge (`sku_platform_ids`) — to a
 * SKU needed by a *currently-pending* order. The Receiving triage pane calls
 * this on carton selection to label the carton **expedited** (unbox first) vs
 * **normal**. Computed live (not persisted) so it never goes stale as orders
 * ship/pack between scan and triage. One indexed round-trip — see
 * `findPendingOrderSkuMatches`.
 *
 * Query params (comma-separated, repeatable):
 *   ?sku=ABC,DEF&zohoItemId=123,456
 */
export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    const url = new URL(request.url);
    const split = (key: string) =>
      url.searchParams
        .getAll(key)
        .flatMap((v) => v.split(','))
        .map((s) => s.trim())
        .filter(Boolean);

    const skus = split('sku');
    const zohoItemIds = split('zohoItemId');

    if (skus.length === 0 && zohoItemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'sku or zohoItemId is required' },
        { status: 400 },
      );
    }

    const pendingSkus = await findPendingOrderSkuMatches(
      ctx.organizationId,
      skus,
      zohoItemIds,
    );
    const expedited = pendingSkus.length > 0;

    return NextResponse.json({
      success: true,
      verdict: expedited ? 'expedited' : 'normal',
      pending_skus: pendingSkus,
    });
  },
  { permission: 'receiving.view' },
);
