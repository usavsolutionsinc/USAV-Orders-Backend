import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { applyOrderTrackingOps } from '@/lib/neon/orders-tracking-queries';
import {
  storeOutboundDocumentFromBytes,
  OutboundDocumentValidationError,
} from '@/lib/documents/outbound-documents';
import { generatePackingSlipPdf } from '@/lib/documents/generate-packing-slip-pdf';
import { publishOrderChanged, publishShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { sendEmailBestEffort } from '@/lib/email/send';
import {
  getShipStationV1,
  getShipStationV2,
  ShipStationNotConnectedError,
} from '@/lib/shipping/shipstation/config';
import { downloadLabelBytes, ShipStationApiError, type LabelPurchaseOptions } from '@/lib/shipping/shipstation/client';
import type { LabelPurchaseResult } from '@/lib/shipping/shipstation/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/outbound/labels/purchase
 *
 * Buy a rate-shopped label via ShipStation v2, then wire it into the existing
 * outbound plumbing:
 *   1. purchase the label (IRREVERSIBLE — charges the account)
 *   2. register the tracking as the order's primary (applyOrderTrackingOps →
 *      STN + shipment_link + orders.shipment_id)
 *   3. store the label bytes as a `shipping_label` document + generate & store a
 *      packing slip (best-effort; GCS-gated, degrades to the public label URL)
 *   4. audit (LABEL_PURCHASED, + LABEL_PRINTED on first label, + TRACKING_ADDED)
 *   5. fire-and-forget realtime + customer ship-notification email
 *
 * Idempotency: `clientEventId` is required and stored as the label document's
 * sourceHash — a retry that already stored a label short-circuits instead of
 * buying a second one. NOTE: ShipStation's create-label is not itself
 * idempotent, so the UI must also disable double-submit; the residual window is
 * a purchase that succeeded but died before the document write.
 *
 * Body: { orderId, rateId, clientEventId, labelFormat?: 'pdf'|'png'|'zpl', notifyCustomer?: boolean }
 */

// `type` (not `interface`) so it satisfies pg/tenantQuery's `QueryResultRow`
// constraint — interfaces lack the implicit index signature.
type OrderRow = {
  id: number;
  order_id: string | null;
  account_source: string | null;
  customer_id: number | null;
  product_title: string | null;
  sku: string | null;
  quantity: string | null;
};

async function loadOrder(orgId: OrgId, orderId: number): Promise<OrderRow | null> {
  const res = await tenantQuery<OrderRow>(
    orgId,
    `SELECT id, order_id, account_source, customer_id, product_title, sku, quantity
       FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [orderId, orgId],
  );
  return res.rows[0] ?? null;
}

/** A prior successful purchase under this clientEventId (label doc sourceHash). */
async function findLabelBySourceHash(
  orgId: OrgId,
  sourceHash: string,
): Promise<{ id: number; tracking: string | null; carrier: string | null } | null> {
  const res = await tenantQuery<{ id: number; tracking: string | null; carrier: string | null }>(
    orgId,
    `SELECT id, document_data->>'tracking' AS tracking, document_data->>'carrier' AS carrier
       FROM documents
      WHERE organization_id = $1 AND document_type = 'shipping_label'
        AND document_data->>'sourceHash' = $2
      LIMIT 1`,
    [orgId, sourceHash],
  );
  return res.rows[0] ?? null;
}

async function resolveCustomerEmail(orgId: OrgId, order: OrderRow): Promise<string | null> {
  if (order.customer_id) {
    const res = await tenantQuery<{ email: string | null }>(
      orgId,
      `SELECT NULLIF(email, '') AS email FROM customers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [order.customer_id, orgId],
    );
    if (res.rows[0]?.email) return res.rows[0].email;
  }
  if (order.account_source === 'shipstation' && order.order_id) {
    const v1 = await getShipStationV1(orgId);
    const ssOrder = v1 ? await v1.getOrderByNumber(order.order_id) : null;
    return ssOrder?.customerEmail ?? null;
  }
  return null;
}

function buildShipEmail(to: string, orderRef: string, label: LabelPurchaseResult) {
  const carrier = label.carrierCode ? label.carrierCode.toUpperCase() : 'the carrier';
  const text = [
    `Good news — your order ${orderRef} is on its way.`,
    '',
    `Carrier: ${carrier}`,
    `Tracking number: ${label.trackingNumber}`,
    '',
    'Thank you for your order.',
  ].join('\n');
  const html = `<p>Good news — your order <strong>${orderRef}</strong> is on its way.</p>
<p><strong>Carrier:</strong> ${carrier}<br/><strong>Tracking number:</strong> ${label.trackingNumber}</p>
<p>Thank you for your order.</p>`;
  return { to, subject: `Your order ${orderRef} has shipped`, text, html };
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const orgId = ctx.organizationId as OrgId;
  try {
    const body = await req.json().catch(() => null);
    const orderId = Number(body?.orderId);
    const rateId = String(body?.rateId || '').trim();
    const clientEventId = String(body?.clientEventId || '').trim();
    const labelFormat: LabelPurchaseOptions['labelFormat'] = ['pdf', 'png', 'zpl'].includes(body?.labelFormat)
      ? body.labelFormat
      : 'pdf';
    const notifyCustomer = body?.notifyCustomer !== false; // default on

    if (!Number.isFinite(orderId) || orderId <= 0) throw ApiError.badRequest('Valid orderId is required');
    if (!rateId) throw ApiError.badRequest('rateId is required');
    if (!clientEventId) throw ApiError.badRequest('clientEventId is required (idempotency key)');

    const order = await loadOrder(orgId, orderId);
    if (!order) throw ApiError.notFound('order', orderId);
    const orderRef = order.order_id || `order-${orderId}`;

    // Idempotency short-circuit — don't buy a second label for the same key.
    const prior = await findLabelBySourceHash(orgId, clientEventId);
    if (prior) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        tracking: prior.tracking,
        carrier: prior.carrier,
        labelDocumentId: prior.id,
      });
    }

    // 1. Buy the label — IRREVERSIBLE.
    const v2 = await getShipStationV2(orgId);
    const label = await v2.purchaseLabelFromRate(rateId, { labelFormat });

    // 2. Register the tracking as the order's primary (STN + link + cache).
    let primaryShipmentId: number | null = null;
    try {
      const trk = await applyOrderTrackingOps({
        orderIds: [orderId],
        organizationId: orgId,
        primaryTrackingNumber: label.trackingNumber,
      });
      primaryShipmentId = trk.primaryShipmentId;
    } catch (e) {
      console.error('[buy-label] tracking register failed', e);
    }

    // 3a. Store the label bytes (best-effort; GCS-gated).
    const labelUrl =
      label.labelDownload.pdf ||
      label.labelDownload.href ||
      label.labelDownload.png ||
      label.labelDownload.zpl ||
      null;
    let labelDocumentId: number | null = null;
    let isFirstLabel = false;
    let warning: string | null = null;
    try {
      if (labelUrl) {
        const { buffer, contentType } = await downloadLabelBytes(labelUrl);
        const stored = await storeOutboundDocumentFromBytes(orgId, {
          orderId,
          orderRef,
          documentType: 'shipping_label',
          platform: 'shipstation',
          source: 'shipstation_api',
          buffer,
          contentType,
          tracking: label.trackingNumber,
          carrier: label.carrierCode,
          uploadedBy: ctx.staffId,
          sourceHash: clientEventId,
          filename: `label-${label.trackingNumber}.${labelFormat}`,
        });
        labelDocumentId = stored.document.id;
        isFirstLabel = stored.isFirstLabel;
      }
    } catch (e) {
      warning =
        e instanceof OutboundDocumentValidationError
          ? 'Label purchased, but document storage is not configured — open/print it from the label URL.'
          : `Label purchased, but storing the label document failed: ${e instanceof Error ? e.message : String(e)}`;
      console.warn('[buy-label] label document store failed', e);
    }

    // 3b. Generate + store the packing slip (best-effort; GCS-gated).
    try {
      const slip = generatePackingSlipPdf({
        orderRef,
        platform: 'shipstation',
        lines: [{ sku: order.sku, title: order.product_title, quantity: order.quantity }],
        tracking: label.trackingNumber,
      });
      await storeOutboundDocumentFromBytes(orgId, {
        orderId,
        orderRef,
        documentType: 'packing_slip',
        platform: 'shipstation',
        source: 'generated',
        buffer: slip,
        contentType: 'application/pdf',
        tracking: label.trackingNumber,
        carrier: label.carrierCode,
        uploadedBy: ctx.staffId,
        sourceHash: `${clientEventId}:slip`,
        filename: `packing-slip-${orderRef}.pdf`,
      });
    } catch (e) {
      console.warn('[buy-label] packing slip store failed', e);
    }

    // 4. Audit trail (recordAudit never throws).
    await recordAudit(pool, ctx, req, {
      source: 'api.outbound.labels.purchase',
      action: AUDIT_ACTION.LABEL_PURCHASED,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      after: {
        tracking: label.trackingNumber,
        carrier: label.carrierCode,
        service: label.serviceCode,
        cost: label.cost,
        currency: label.currency,
        labelId: label.labelId,
        rateId,
      },
      extra: { shipmentId: primaryShipmentId, labelDocumentId },
    });
    if (isFirstLabel) {
      await recordAudit(pool, ctx, req, {
        source: 'api.outbound.labels.purchase',
        action: AUDIT_ACTION.LABEL_PRINTED,
        entityType: AUDIT_ENTITY.ORDER,
        entityId: orderId,
        after: { tracking: label.trackingNumber, carrier: label.carrierCode },
      });
    }
    await recordAudit(pool, ctx, req, {
      source: 'api.outbound.labels.purchase',
      action: AUDIT_ACTION.TRACKING_ADDED,
      entityType: AUDIT_ENTITY.ORDER,
      entityId: orderId,
      after: { tracking: label.trackingNumber },
    });

    // 5. Fire-and-forget: realtime + cache + customer notification.
    after(async () => {
      try {
        await invalidateCacheTags(['orders', 'shipped', 'orders-next']);
        await publishOrderChanged({ organizationId: orgId, orderIds: [orderId], source: 'outbound.buy-label' });
        if (primaryShipmentId) {
          await publishShipmentChanged({
            organizationId: orgId,
            shipmentId: primaryShipmentId,
            trackingNumber: label.trackingNumber,
            source: 'outbound.buy-label',
          });
        }
      } catch (e) {
        console.warn('[buy-label] realtime/cache failed', e);
      }
      if (notifyCustomer) {
        try {
          const email = await resolveCustomerEmail(orgId, order);
          if (email) await sendEmailBestEffort(buildShipEmail(email, orderRef, label));
        } catch (e) {
          console.warn('[buy-label] customer notification failed', e);
        }
      }
    });

    return NextResponse.json({
      ok: true,
      tracking: label.trackingNumber,
      carrier: label.carrierCode,
      service: label.serviceCode,
      cost: label.cost,
      currency: label.currency,
      labelId: label.labelId,
      labelUrl,
      shipmentId: primaryShipmentId,
      labelDocumentId,
      warning,
    });
  } catch (error) {
    if (error instanceof ShipStationNotConnectedError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: 'SHIPSTATION_NOT_CONNECTED' },
        { status: 400 },
      );
    }
    if (error instanceof ShipStationApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.isNotConnected ? 400 : 502 },
      );
    }
    return errorResponse(error, 'POST /api/outbound/labels/purchase');
  }
}, { permission: 'shipping.buy_label' });
