import { NextRequest, NextResponse } from 'next/server';
import {
  createDemandAlert,
  getSourcingAlertById,
  getSourcingAlerts,
  updateSourcingAlertStatus,
} from '@/lib/neon/sourcing-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingAlertCreateBody, SourcingAlertPatchBody } from '@/lib/schemas/sourcing';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_ALERT_CREATE = 'sourcing-alert.create';

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
 * POST /api/sourcing/alerts — Manually open a demand row ("Source this").
 *
 * Body: { skuId?, searchQuery?, boseModelId?, severity?, reason?, targetQty? }.
 * At least one of skuId / searchQuery is required. Lands as a `manual`
 * demand_source; idempotent for SKU-backed rows (returns the live row, 200) and
 * on Idempotency-Key. 201 when a new row is created.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingAlertCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_ALERT_CREATE);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const { row, created } = await createDemandAlert({
      skuId: parsed.skuId ?? null,
      boseModelId: parsed.boseModelId ?? null,
      searchQuery: parsed.searchQuery ?? null,
      alertType: parsed.alertType ?? 'manual',
      demandSource: 'manual',
      severity: parsed.severity ?? 'warn',
      reason: parsed.reason ?? null,
      targetQty: parsed.targetQty ?? null,
    });

    if (created) {
      await recordAudit(pool, ctx, req, {
        source: 'sourcing-alerts-api',
        action: AUDIT_ACTION.SOURCING_ALERT_CREATE,
        entityType: AUDIT_ENTITY.SOURCING_ALERT,
        entityId: row.id,
        after: { ...row },
      });
    }

    const responseBody = { success: true, alert: row, created };
    const statusCode = created ? 201 : 200;
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_ALERT_CREATE,
        staffId: ctx.staffId,
        statusCode,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: statusCode });
  } catch (error: any) {
    if (error?.code === '23503') {
      return NextResponse.json({ success: false, error: 'Unknown skuId' }, { status: 400 });
    }
    console.error('Error in POST /api/sourcing/alerts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create demand' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage' });

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
