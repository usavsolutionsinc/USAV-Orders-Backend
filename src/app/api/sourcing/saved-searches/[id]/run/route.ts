import { NextRequest, NextResponse } from 'next/server';
import {
  getSourcingSearchById,
  markSourcingSearchRun,
} from '@/lib/neon/sourcing-searches-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { scour } from '@/lib/sourcing/search';
import type { CandidateSource } from '@/lib/sourcing/normalize';
import type { BrowseCondition } from '@/lib/ebay/browse-client';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * POST /api/sourcing/saved-searches/[id]/run — run a standing search now.
 *
 * Runs one scour across the search's channels, saves the hits to the watchlist
 * (linked to its sku/alert), and stamps last_run_at. The user-initiated mirror
 * of the scour-watch cron.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireRoutePerm(req, 'sourcing.search');
    if (gate.denied) return gate.denied;
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const search = await getSourcingSearchById(id, gate.ctx.organizationId);
    if (!search) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const result = await scour({
      query: search.query,
      skuId: search.sku_id,
      sourcingAlertId: search.sourcing_alert_id,
      conditions: (search.conditions ?? undefined) as BrowseCondition[] | undefined,
      maxPriceCents: search.max_price_cents,
      sources: (search.sources ?? undefined) as CandidateSource[] | undefined,
      limit: 20,
      save: true,
      orgId: gate.ctx.organizationId,
    });
    await markSourcingSearchRun(id, result.results.length, gate.ctx.organizationId);

    await recordAudit(pool, gate.ctx, req, {
      source: 'sourcing-saved-searches-api',
      action: AUDIT_ACTION.SOURCING_SAVED_SEARCH_RUN,
      entityType: AUDIT_ENTITY.SOURCING_SAVED_SEARCH,
      entityId: id,
      after: { query: result.query, hits: result.results.length, saved: result.saved },
      extra: { bySource: result.bySource },
    });

    return NextResponse.json({
      success: true,
      hits: result.results.length,
      saved: result.saved,
      bySource: result.bySource,
    });
  } catch (error: any) {
    const msg = error?.message || 'Run failed';
    const status = /credential|token|Browse|channel|configured/i.test(msg) ? 502 : 500;
    console.error('Error in POST /api/sourcing/saved-searches/[id]/run:', error);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
