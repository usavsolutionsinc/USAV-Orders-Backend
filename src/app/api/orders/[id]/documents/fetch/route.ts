import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { OutboundDocumentFetchBody } from '@/lib/schemas/documents';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { fetchOutboundDocuments } from '@/lib/documents/outbound-documents';
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import pool from '@/lib/db';

/**
 * Trigger a marketplace document fetch for an order. Uses platform adapters when
 * OUTBOUND_MARKETPLACE_FETCH is enabled (default); otherwise returns a clear
 * manual-upload message.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.create');
  if (gate.denied) return gate.denied;

  const { id: rawId } = await params;
  const orderId = parseId(rawId);
  if (orderId === null) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = parseBody(OutboundDocumentFetchBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  const orgId = gate.ctx.organizationId as OrgId;

  try {
    const owner = await tenantQuery(orgId, `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`, [orderId, orgId]);
    if (owner.rowCount === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const result = await fetchOutboundDocuments(orgId, orderId, parsed.types);

    await recordAudit(pool, gate.ctx, req, {
      source: 'orders-documents-api',
      action: AUDIT_ACTION.ORDER_DOCUMENT_FETCH,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      after: { requested: parsed.types, fetched: result.fetched.map((d) => d.id), failed: result.failed },
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    console.error('Error in POST /api/orders/[id]/documents/fetch:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}
