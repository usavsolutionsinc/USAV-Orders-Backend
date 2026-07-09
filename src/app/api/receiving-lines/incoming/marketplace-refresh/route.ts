/**
 * POST /api/receiving-lines/incoming/marketplace-refresh
 *
 * Operator-triggered pull of marketplace buyer purchases (eBay today; Amazon when
 * inbound lands) into the Incoming spine. Mirrors the cron at
 * /api/cron/ebay/purchase-sync but is gated by receiving.view for the Incoming
 * sidebar "Marketplace" sync button.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { isIncomingUniversal } from '@/lib/feature-flags';
import { syncEbayPurchasesToReceiving } from '@/lib/inbound/sync-ebay-purchases';
import { resolveInboundSettings, isInboundSourceEnabled } from '@/lib/inbound/org-settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withAuth(async (_req: NextRequest, ctx) => {
  const startedAt = Date.now();
  try {
    if (!(await isIncomingUniversal(ctx.organizationId))) {
      return NextResponse.json({
        ok: false,
        error: 'Universal Incoming is not enabled for this organization.',
      }, { status: 400 });
    }

    const settings = await resolveInboundSettings(ctx.organizationId);
    const ebayEnabled = isInboundSourceEnabled(settings, 'ebay');
    const amazonEnabled = isInboundSourceEnabled(settings, 'amazon');

    let ebay = { accounts: 0, linesFetched: 0, ingested: 0, created: 0, errors: [] as string[] };
    if (ebayEnabled) {
      const r = await syncEbayPurchasesToReceiving(ctx.organizationId);
      ebay = {
        accounts: r.accounts,
        linesFetched: r.linesFetched,
        ingested: r.ingested,
        created: r.created,
        errors: r.errors,
      };
    }

    const notes: string[] = [];
    if (!ebayEnabled) notes.push('eBay inbound source is disabled for this org.');
    if (amazonEnabled) notes.push('Amazon inbound sync is not available yet.');
    if (ebayEnabled && ebay.linesFetched === 0 && ebay.ingested === 0 && ebay.errors.length === 0) {
      notes.push('eBay Buy Order API is not live yet — no new purchases pulled. Use Import eBay order to bridge manually.');
    }

    if (ebay.created > 0 || ebay.ingested > 0) {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
      } catch (err) {
        console.warn('incoming/marketplace-refresh: cache invalidate failed (non-fatal)', err);
      }
    }

    return NextResponse.json({
      ok: ebay.errors.length === 0,
      ebay,
      notes,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-lines/incoming/marketplace-refresh');
  }
}, { permission: 'receiving.view' });
