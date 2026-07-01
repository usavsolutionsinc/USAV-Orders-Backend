import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { parseBody } from '@/lib/schemas/parse';
import { OutboundDocumentAttachBody } from '@/lib/schemas/documents';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  attachOutboundDocument,
  listDocumentsForOrder,
  OutboundDocumentConflictError,
  OutboundDocumentNotFoundError,
  OutboundDocumentValidationError,
} from '@/lib/documents/outbound-documents';
import { resolveOutboundNasTarget } from '@/lib/documents/resolve-nas-target';
import type { OrgId } from '@/lib/tenancy/constants';
import pool from '@/lib/db';

/**
 * Outbound documents (packing slips + shipping labels) for one order.
 * docs/outbound-documents-plan.md §8.2. Supersedes /api/order-labels, which
 * stays a thin wrapper over this domain module (dual-read, no new writes to
 * the legacy entity_type='SHIPPING_LABEL' shape).
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.view');
  if (gate.denied) return gate.denied;

  const { id: rawId } = await params;
  const orderId = parseId(rawId);
  if (orderId === null) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  try {
    const orgId = gate.ctx.organizationId as OrgId;
    const [documents, nasTarget] = await Promise.all([
      listDocumentsForOrder(orgId, orderId),
      resolveOutboundNasTarget(orgId, gate.ctx.staffId),
    ]);
    return NextResponse.json({ success: true, documents, ...nasTarget });
  } catch (error) {
    console.error('Error in GET /api/orders/[id]/documents:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
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
  const parsed = parseBody(OutboundDocumentAttachBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    // Manual-upload URL allowlist, order-ownership, and dupe checks all live
    // inside attachOutboundDocument (single transaction) — see
    // src/lib/documents/outbound-documents.ts.
    const { document, isFirstLabel } = await attachOutboundDocument(gate.ctx.organizationId as OrgId, {
      orderId,
      documentType: parsed.documentType,
      url: parsed.url,
      platform: parsed.platform ?? null,
      source: parsed.source ?? 'manual_upload',
      carrier: parsed.carrier ?? null,
      tracking: parsed.tracking ?? null,
      mimeType: parsed.mimeType ?? null,
      filename: parsed.filename ?? null,
      uploadedBy: gate.ctx.staffId,
    });

    await recordAudit(pool, gate.ctx, req, {
      source: 'orders-documents-api',
      action: AUDIT_ACTION.ORDER_DOCUMENT_ATTACH,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      after: { documentId: document.id, documentType: document.documentType, url: parsed.url },
    });

    // First label on the order also feeds the order timeline (EventTimeline
    // precedent) — distinct verb, kept stable per source-of-truth rules.
    if (isFirstLabel) {
      await recordAudit(pool, gate.ctx, req, {
        source: 'orders-documents-api',
        action: AUDIT_ACTION.LABEL_PRINTED,
        entityType: AUDIT_ENTITY.ORDER,
        entityId: orderId,
        after: { url: parsed.url, carrier: parsed.carrier ?? null, tracking: parsed.tracking ?? null },
      });
    }

    return NextResponse.json({ success: true, document }, { status: 201 });
  } catch (error) {
    if (error instanceof OutboundDocumentNotFoundError) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (error instanceof OutboundDocumentConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof OutboundDocumentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error in POST /api/orders/[id]/documents:', error);
    return NextResponse.json({ error: 'Failed to attach document' }, { status: 500 });
  }
}
