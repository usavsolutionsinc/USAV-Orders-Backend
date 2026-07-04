/**
 * /api/receiving/rail-exclusions — per-staff receiving-rail dismiss (universal-feed
 * plan Phase 4). Replaces the old destructive bulk-DELETE: dismissing hides an
 * entity from THIS staffer's rail only (a staff_rail_exclusions row), reversibly.
 *
 *   GET    ?feedKey=receiving_triage        → { items: [{ entityType, entityId }] }  (this staff's exclusions)
 *   POST   { feedKey, items:[{entityType,entityId}] } → { success, count }  (dismiss)
 *   DELETE { feedKey, items:[{entityType,entityId}] } → { success, count }  (restore)
 *
 * staffId + orgId always come from the verified session (ctx), never the body.
 * Gated on `receiving.view` — a dismiss only affects the caller's own view, so
 * it is strictly weaker than the shared delete it replaces.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { RailExclusionBody } from '@/lib/schemas/rail-exclusions';
import {
  addRailExclusions,
  removeRailExclusions,
  listRailExclusions,
  RECEIVING_RAIL_FEED_KEYS,
} from '@/lib/receiving/rail-exclusions';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const runtime = 'nodejs';

const AUDIT_SOURCE = 'receiving-rail-exclusions-api';

export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const feedKey = String(new URL(req.url).searchParams.get('feedKey') ?? '');
    if (!(RECEIVING_RAIL_FEED_KEYS as readonly string[]).includes(feedKey)) {
      return NextResponse.json({ error: 'INVALID_FEED_KEY' }, { status: 400 });
    }
    const items = await listRailExclusions(ctx.organizationId, ctx.staffId, feedKey);
    return NextResponse.json({ success: true, items });
  },
  { permission: 'receiving.view' },
);

export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(RailExclusionBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const result = await addRailExclusions({
      orgId: ctx.organizationId,
      staffId: ctx.staffId,
      feedKey: parsed.feedKey,
      items: parsed.items,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });

    await recordAudit(pool, ctx, req, {
      source: AUDIT_SOURCE,
      action: AUDIT_ACTION.RAIL_EXCLUSION_ADD,
      entityType: AUDIT_ENTITY.RAIL_EXCLUSION,
      entityId: `${ctx.staffId}:${parsed.feedKey}`,
      after: { feedKey: parsed.feedKey, count: result.count, items: result.applied },
    });
    return NextResponse.json({ success: true, count: result.count });
  },
  { permission: 'receiving.view' },
);

export const DELETE = withAuth(
  async (req: NextRequest, ctx) => {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(RailExclusionBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const result = await removeRailExclusions({
      orgId: ctx.organizationId,
      staffId: ctx.staffId,
      feedKey: parsed.feedKey,
      items: parsed.items,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });

    await recordAudit(pool, ctx, req, {
      source: AUDIT_SOURCE,
      action: AUDIT_ACTION.RAIL_EXCLUSION_REMOVE,
      entityType: AUDIT_ENTITY.RAIL_EXCLUSION,
      entityId: `${ctx.staffId}:${parsed.feedKey}`,
      after: { feedKey: parsed.feedKey, count: result.count, items: result.applied },
    });
    return NextResponse.json({ success: true, count: result.count });
  },
  { permission: 'receiving.view' },
);
