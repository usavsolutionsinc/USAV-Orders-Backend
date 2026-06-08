import { NextRequest, NextResponse } from 'next/server';
import {
  getSourcingAlertById,
  getSourcingAlerts,
  updateSourcingAlertStatus,
} from '@/lib/neon/sourcing-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingAlertPatchBody } from '@/lib/schemas/sourcing';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * GET /api/sourcing/alerts?status=&skuId= — the auto-flag queue.
 * Defaults to live (open + sourcing) alerts, ordered critical → warn → info.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const skuId = searchParams.get('skuId');

    const items = await getSourcingAlerts({
      status,
      skuId: skuId ? Number(skuId) : null,
    });
    return NextResponse.json({ success: true, items, total: items.length });
  } catch (error: any) {
    console.error('Error in GET /api/sourcing/alerts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch alerts' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });

/**
 * PATCH /api/sourcing/alerts — Resolve / dismiss / progress an alert.
 *
 * Body: { id, status, reason? }. Resolving or dismissing requires a `reason`
 * (sourcing.alert.resolve is reason-required) → 400 without one.
 */
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingAlertPatchBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const isClosing = parsed.status === 'resolved' || parsed.status === 'dismissed';
    if (isClosing && !parsed.reason?.trim()) {
      return NextResponse.json(
        { success: false, error: 'A reason is required to resolve or dismiss an alert' },
        { status: 400 },
      );
    }

    const before = await getSourcingAlertById(parsed.id);
    if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const updated = await updateSourcingAlertStatus({
      id: parsed.id,
      status: parsed.status,
      reason: parsed.reason ?? null,
      resolvedBy: ctx.staffId,
    });

    await recordAudit(pool, ctx, req, {
      source: 'sourcing-alerts-api',
      action: AUDIT_ACTION.SOURCING_ALERT_RESOLVE,
      entityType: AUDIT_ENTITY.SOURCING_ALERT,
      entityId: parsed.id,
      reasonCode: parsed.reason ?? null,
      before: { ...before },
      after: updated ? { ...updated } : null,
    });

    return NextResponse.json({ success: true, alert: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/sourcing/alerts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update alert' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage' });
