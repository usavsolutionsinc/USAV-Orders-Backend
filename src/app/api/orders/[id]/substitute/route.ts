import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { audit } from '@/lib/auth/audit';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getSubstitutionEnforcement, getSubstitutionAllowedNodes } from '@/lib/tenancy/settings';
import { isFulfillmentSubstitution } from '@/lib/feature-flags';
import { substituteOrderUnit, type AmendmentNode } from '@/lib/fulfillment/substitution';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * POST /api/orders/[id]/substitute
 *
 * Fulfillment substitution — the unit physically shipping deviates from what was
 * ordered/listed ("customer asked for white though the order is for black", a
 * tester regrades, a picker swaps the serial). Modeled as an AUDITED
 * RE-ALLOCATION: release the original allocation + allocate the substitute unit
 * + record the ordered-vs-fulfilled delta (order_unit_amendments). Because the
 * substitute unit ends up with a real open allocation, /api/pack/ship's
 * allocation check passes for it unchanged.
 *
 * Body:
 *   {
 *     original_allocation_id: number,    // the allocation being replaced
 *     substitute_unit_id?: number,       // explicit id ...
 *     substitute_serial?: string,        // ... or a raw serial scan (GS1 URL OK)
 *     reason_code: string,               // required — the deviation must justify itself
 *     customer_request_note?: string,
 *     photo_id?: number,
 *     raised_at_node?: 'pick'|'test'|'pack',  // default 'pick'; must be org-allowed
 *     client_event_id?: string           // UUID, idempotent retries
 *   }
 *
 * Enforcement (per-org settings.fulfillment): 'advisory' → APPLIED + shippable;
 * 'block_until_approved' → PENDING (the order can't pack/ship until approved).
 *
 * Permission: packing.substitute_unit OR tech.substitute_unit (a substitution
 * can be raised from the pack bench or the tech/testing bench —
 * docs/todo/tech-substitution-wiring-plan.md §3.3 Option B). withAuth's single
 * `permission` option can't express an OR, so the pair is enforced in-handler
 * (the sanctioned pattern — cf. /api/settings PUT, the photo-label writes);
 * the manifest records this file as authed-no-permission with the real gate
 * asserted in route-permission-manifest.test.ts.
 */
const SUBSTITUTE_PERMISSIONS = ['packing.substitute_unit', 'tech.substitute_unit'] as const;

export const POST = withAuth(async (request, ctx) => {
  if (!SUBSTITUTE_PERMISSIONS.some((p) => ctx.permissions.has(p))) {
    // Mirror withAuth's own permission-denied path (403 + auth_audit row).
    await audit({
      staffId: ctx.staffId,
      event: 'permission.denied',
      result: 'denied',
      sid: ctx.session?.sid ?? null,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: request.headers.get('user-agent'),
      detail: { permission: SUBSTITUTE_PERMISSIONS.join('|'), api: true, path: request.nextUrl.pathname },
    });
    return NextResponse.json(
      { error: 'FORBIDDEN', permission: SUBSTITUTE_PERMISSIONS.join('|'), role: ctx.role },
      { status: 403 },
    );
  }

  if (!isFulfillmentSubstitution()) {
    return NextResponse.json({ ok: false, error: 'substitution is not enabled' }, { status: 403 });
  }

  const orgId = ctx.organizationId as OrgId;

  // [id] segment: /api/orders/{id}/substitute → second-to-last.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const orderId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  const originalAllocationId = Number(body?.original_allocation_id);
  if (!Number.isFinite(originalAllocationId) || originalAllocationId <= 0) {
    return NextResponse.json({ ok: false, error: 'original_allocation_id is required' }, { status: 400 });
  }
  const reasonCode = String(body?.reason_code || '').trim();
  if (!reasonCode) {
    return NextResponse.json({ ok: false, error: 'reason_code is required' }, { status: 400 });
  }
  const customerRequestNote = String(body?.customer_request_note || '').trim() || null;
  const photoIdRaw = Number(body?.photo_id);
  const photoId = Number.isFinite(photoIdRaw) && photoIdRaw > 0 ? Math.floor(photoIdRaw) : null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;
  const raisedAtNode = String(body?.raised_at_node || 'pick').trim() as AmendmentNode;

  // Resolve the substitute unit — explicit id wins; else resolve a raw serial.
  const explicitSubId = Number(body?.substitute_unit_id);
  let substituteUnitId = Number.isFinite(explicitSubId) && explicitSubId > 0 ? Math.floor(explicitSubId) : null;
  if (!substituteUnitId) {
    const rawSerial = String(body?.substitute_serial || '').trim();
    if (!rawSerial) {
      return NextResponse.json(
        { ok: false, error: 'substitute_unit_id or substitute_serial is required' },
        { status: 400 },
      );
    }
    const parsed = parseScannedUrl(rawSerial);
    const normalized = (parsed && parsed.type === 'unit' ? parsed.unitSerial : rawSerial).toUpperCase();
    const found = await tenantQuery<{ id: number }>(
      orgId,
      `SELECT id FROM serial_units WHERE normalized_serial = $1 AND organization_id = $2 LIMIT 1`,
      [normalized, orgId],
    );
    if (!found.rows[0]) {
      return NextResponse.json({ ok: false, error: `substitute serial not found: ${normalized}` }, { status: 404 });
    }
    substituteUnitId = found.rows[0].id;
  }

  // Per-org policy: which node may raise + advisory-vs-block enforcement.
  const org = await getOrganization(orgId);
  const enforcement = org ? getSubstitutionEnforcement(org.settings) : 'advisory';
  const allowedNodes: string[] = org ? getSubstitutionAllowedNodes(org.settings) : ['pick'];
  if (!allowedNodes.includes(raisedAtNode)) {
    return NextResponse.json(
      { ok: false, error: `substitution from '${raisedAtNode}' is not allowed for this org`, allowed_nodes: allowedNodes },
      { status: 403 },
    );
  }

  const actorStaffId: number | null = typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  const result = await substituteOrderUnit(
    {
      originalAllocationId,
      expectedOrderId: orderId,
      substituteUnitId,
      reasonCode,
      customerRequestNote,
      photoId,
      raisedAtNode,
      enforcement,
      actorStaffId,
      clientEventId,
    },
    orgId,
  );

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  // (The URL-vs-allocation order check is enforced inside substituteOrderUnit
  // via expectedOrderId, BEFORE any mutation — no post-commit check needed here.)

  await recordAudit(pool, ctx, request, {
    source: 'orders.substitute',
    action: AUDIT_ACTION.ORDER_SUBSTITUTE_UNIT,
    entityType: AUDIT_ENTITY.ORDER_AMENDMENT,
    entityId: result.amendmentId,
    method: 'manual',
    reasonCode,
    note: customerRequestNote,
    before: { unit_id: result.original.unitId, sku: result.original.sku, condition: result.original.condition },
    after: { unit_id: result.fulfilled.unitId, sku: result.fulfilled.sku, condition: result.fulfilled.condition },
    extra: {
      order_id: orderId,
      amendment_status: result.status,
      raised_at_node: raisedAtNode,
      substitute_allocation_id: result.substituteAllocationId,
      photo_id: photoId,
    },
  });

  // Propagation side-effects (customer notify / sales-channel sync) are per-org
  // and belong in an after() here so they never block the response — wired in a
  // later phase. The amendment row + audit are the durable record they read from.

  return NextResponse.json(result);
});
