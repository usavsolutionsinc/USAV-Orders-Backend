import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  attachOutboundDocument,
  deleteOutboundDocument,
  listDocumentsForOrder,
  OutboundDocumentConflictError,
  OutboundDocumentNotFoundError,
  OutboundDocumentValidationError,
} from '@/lib/documents/outbound-documents';
import { resolveOutboundNasTarget } from '@/lib/documents/resolve-nas-target';
import type { OutboundDocument } from '@/lib/documents/types';

export const dynamic = 'force-dynamic';

/**
 * DEPRECATED — thin wrapper over src/lib/documents/outbound-documents.ts
 * (docs/outbound-documents-plan.md §8.2). Kept only so existing NAS
 * browser-PUT label callers keep working; new code should call
 * `/api/orders/[id]/documents` (documentType='shipping_label') directly,
 * which also returns packing slips and dual-links ORDER + SHIPMENT.
 *
 * Response shape is unchanged from the pre-migration route so no client
 * update is required for this release. URL allowlist / order-ownership /
 * dupe checks now live once in the domain layer instead of being
 * hand-rolled per caller (see outbound-documents.ts).
 */

const DEPRECATION_HEADERS = {
  Deprecation: 'true',
  Link: '</api/orders>; rel="successor-version"',
} as const;

interface LabelRow {
  id: number;
  orderId: number;
  url: string;
  carrier: string | null;
  tracking: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

function toLabelRow(doc: OutboundDocument, orderId: number): LabelRow {
  return {
    id: doc.id,
    orderId,
    url: doc.data.url,
    carrier: doc.data.carrier ?? null,
    tracking: doc.data.tracking ?? null,
    uploadedBy: doc.data.uploadedBy ?? null,
    createdAt: doc.createdAt,
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orderId = Number(new URL(req.url).searchParams.get('orderId'));
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw ApiError.badRequest('Valid orderId is required');
    }

    // listDocumentsForOrder already scopes by organization_id, so a foreign
    // orderId just returns an empty list — no separate ownership round trip.
    const documents = await listDocumentsForOrder(ctx.organizationId as OrgId, orderId);
    const labels = documents
      .filter((d) => d.documentType === 'shipping_label')
      .map((d) => toLabelRow(d, orderId));

    const { nasBaseUrl, nasFolder } = await resolveOutboundNasTarget(ctx.organizationId as OrgId, ctx.staffId);

    return NextResponse.json({ labels, nasBaseUrl, nasFolder }, { headers: DEPRECATION_HEADERS });
  } catch (error) {
    return errorResponse(error, 'GET /api/order-labels');
  }
}, { permission: 'orders.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const orderId = Number(body?.orderId);
    const labelUrl = String(body?.labelUrl || '').trim();
    const carrier = String(body?.carrier || '').trim() || null;
    const tracking = String(body?.tracking || '').trim() || null;
    const uploadedBy = ctx.staffId;

    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw ApiError.badRequest('Valid orderId is required');
    }
    if (!labelUrl) throw ApiError.badRequest('labelUrl is required');

    let attached;
    try {
      attached = await attachOutboundDocument(ctx.organizationId as OrgId, {
        orderId,
        documentType: 'shipping_label',
        url: labelUrl,
        source: 'manual_upload',
        carrier,
        tracking,
        uploadedBy,
      });
    } catch (error) {
      if (error instanceof OutboundDocumentNotFoundError) throw ApiError.notFound('order', orderId);
      if (error instanceof OutboundDocumentConflictError) throw ApiError.conflict('Label already attached');
      if (error instanceof OutboundDocumentValidationError) throw ApiError.badRequest(error.message);
      throw error;
    }

    await recordAudit(pool, ctx, req, {
      source: 'api.order-labels',
      action: AUDIT_ACTION.ORDER_DOCUMENT_ATTACH,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      after: { documentId: attached.document.id, url: labelUrl, carrier, tracking },
    });

    if (attached.isFirstLabel) {
      await recordAudit(pool, ctx, req, {
        source: 'api.order-labels',
        action: AUDIT_ACTION.LABEL_PRINTED,
        entityType: AUDIT_ENTITY.ORDER,
        entityId: orderId,
        after: { labelUrl, carrier, tracking },
      });
    }

    return NextResponse.json(
      { success: true, label: toLabelRow(attached.document, orderId) },
      { headers: DEPRECATION_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, 'POST /api/order-labels');
  }
}, { permission: 'orders.create' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) throw ApiError.badRequest('Valid id is required');

    let deleted;
    try {
      // This endpoint only ever unlinks labels — expectedDocumentType checks
      // that inside the same transaction as the existence check, so a slip id
      // (caller bug) 404s instead of a separate pre-check round trip.
      deleted = await deleteOutboundDocument(ctx.organizationId as OrgId, id, { expectedDocumentType: 'shipping_label' });
    } catch (error) {
      if (error instanceof OutboundDocumentNotFoundError) throw ApiError.notFound('label', id);
      throw error;
    }

    await recordAudit(pool, ctx, req, {
      source: 'api.order-labels',
      action: AUDIT_ACTION.ORDER_DOCUMENT_DELETE,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: deleted.orderId ?? id,
      before: { documentId: deleted.id },
    });

    return NextResponse.json({ success: true, id }, { headers: DEPRECATION_HEADERS });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/order-labels');
  }
}, { permission: 'orders.create' });
