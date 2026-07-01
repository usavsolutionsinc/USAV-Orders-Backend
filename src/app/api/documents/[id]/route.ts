import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { deleteOutboundDocument, OutboundDocumentNotFoundError } from '@/lib/documents/outbound-documents';
import type { OrgId } from '@/lib/tenancy/constants';
import pool from '@/lib/db';

/**
 * Unlink + delete one outbound document (docs/outbound-documents-plan.md §8.2).
 * Removes the `documents` row (document_entity_links cascade via FK); never
 * touches the owning order/shipment records.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'orders.create');
  if (gate.denied) return gate.denied;

  const { id: rawId } = await params;
  const documentId = parseId(rawId);
  if (documentId === null) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }

  try {
    const deleted = await deleteOutboundDocument(gate.ctx.organizationId as OrgId, documentId);

    await recordAudit(pool, gate.ctx, req, {
      source: 'orders-documents-api',
      action: AUDIT_ACTION.ORDER_DOCUMENT_DELETE,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: deleted.orderId ?? documentId,
      before: { documentId: deleted.id, documentType: deleted.documentType },
    });

    return NextResponse.json({ success: true, id: documentId });
  } catch (error) {
    if (error instanceof OutboundDocumentNotFoundError) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    console.error('Error in DELETE /api/documents/[id]:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
