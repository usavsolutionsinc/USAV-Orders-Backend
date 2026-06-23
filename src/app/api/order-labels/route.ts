import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization } from '@/lib/tenancy/organizations';
import { getActiveNasBaseUrl, getAllNasBaseUrls, getNasStorageTarget } from '@/lib/tenancy/settings';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolveOperatorNasFolder } from '@/lib/nas-photos-server';
import { createAuditLog } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

/**
 * Outbound shipping LABELS for an order.
 *
 * Labels are externally produced (ShipStation / carrier site), printed, then
 * dropped onto the order. The file lives on the office NAS — the BROWSER PUTs it
 * straight over WebDAV (same path as receiving photos; the Vercel server can't
 * reach the LAN), then POSTs the resulting URL here to link it. This route only
 * ever stores a URL, never bytes.
 *
 * Stored polymorphically on `documents`:
 *   entity_type='SHIPPING_LABEL', entity_id=orders.id,
 *   document_type='shipping_label',
 *   document_data={ url, carrier?, tracking?, uploadedBy }
 *
 * The first label attached to an order records an `orders.label.printed` audit
 * event (feeds the order timeline). Full CRUD: GET (list) / POST (attach) /
 * DELETE (unlink).
 */

interface LabelRow {
  id: number;
  orderId: number;
  url: string;
  carrier: string | null;
  tracking: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface DbRow {
  id: number;
  entity_id: number;
  document_data: Record<string, unknown>;
  created_at: string;
}

function mapRow(row: DbRow): LabelRow {
  const data = row.document_data || {};
  return {
    id: Number(row.id),
    orderId: Number(row.entity_id),
    url: String(data.url ?? ''),
    carrier: (data.carrier as string | undefined) ?? null,
    tracking: (data.tracking as string | undefined) ?? null,
    uploadedBy: data.uploadedBy != null ? Number(data.uploadedBy) : null,
    createdAt: row.created_at,
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orderId = Number(new URL(req.url).searchParams.get('orderId'));
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw ApiError.badRequest('Valid orderId is required');
    }

    // `documents` has no organization_id; gate tenant access on the owning
    // order instead. 404 (not 403) on a cross-org / missing order.
    const owner = await tenantQuery(
      ctx.organizationId as OrgId,
      `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [orderId, ctx.organizationId],
    );
    if (owner.rowCount === 0) throw ApiError.notFound('order', orderId);

    const result = await pool.query<DbRow>(
      `SELECT id, entity_id, document_data, created_at
         FROM documents
        WHERE entity_type = 'SHIPPING_LABEL' AND entity_id = $1
        ORDER BY created_at DESC`,
      [orderId],
    );

    // Surface the NAS base + outbound label folder so the client can build the
    // PUT URL. Falls back to the operator's station folder for older settings.
    let nasBaseUrl = '';
    let nasFolder = '';
    try {
      const orgId = ctx.organizationId as OrgId;
      const [org, folder] = await Promise.all([
        getOrganization(orgId),
        resolveOperatorNasFolder(orgId, ctx.staffId),
      ]);
      nasFolder = org ? getNasStorageTarget(org.settings, 'shipping').folder || folder : folder;
      nasBaseUrl = process.env.NAS_AGENT_URL
        ? '/api/nas-target/shipping'
        : org ? getActiveNasBaseUrl(org.settings) : '';
    } catch {
      nasBaseUrl = '';
      nasFolder = '';
    }
    // Dev/test fallback so the NAS round-trip works without org settings.
    if (!nasBaseUrl) {
      const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
      if (envBase && !envBase.startsWith('/')) nasBaseUrl = envBase;
    }

    return NextResponse.json({ labels: result.rows.map(mapRow), nasBaseUrl, nasFolder });
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
    const uploadedBy = ctx.staffId; // server-trusted actor

    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw ApiError.badRequest('Valid orderId is required');
    }
    if (!labelUrl) throw ApiError.badRequest('labelUrl is required');

    // `documents` has no organization_id; gate tenant access on the owning
    // order before attaching a label. 404 (not 403) on a cross-org / missing order.
    const owner = await tenantQuery(
      ctx.organizationId as OrgId,
      `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [orderId, ctx.organizationId],
    );
    if (owner.rowCount === 0) throw ApiError.notFound('order', orderId);

    // Origin allowlist — identical boundary to receiving photos: once a NAS base
    // is known, the URL must point at it (or the same-origin dev proxy). Stays
    // permissive only when nothing is configured.
    const org = await getOrganization(ctx.organizationId as OrgId);
    const allowedBases = org ? getAllNasBaseUrls(org.settings) : [];
    const envBase = (process.env.NEXT_PUBLIC_NAS_PHOTOS_BASE_URL || '').replace(/\/+$/, '');
    if (envBase && !envBase.startsWith('/')) allowedBases.push(envBase);
    const isSameOrigin = labelUrl.startsWith('/');
    const isAllowed =
      allowedBases.length === 0 ||
      isSameOrigin ||
      allowedBases.some((base) => labelUrl === base || labelUrl.startsWith(`${base}/`));
    if (!isAllowed) {
      throw ApiError.badRequest('labelUrl must point at the configured NAS address');
    }

    // Idempotency: re-dropping the same label file is a no-op conflict (no unique
    // index across JSONB, so check explicitly).
    const dupe = await pool.query(
      `SELECT 1 FROM documents
        WHERE entity_type = 'SHIPPING_LABEL' AND entity_id = $1
          AND document_data->>'url' = $2 LIMIT 1`,
      [orderId, labelUrl],
    );
    if ((dupe.rowCount ?? 0) > 0) throw ApiError.conflict('Label already attached');

    // First label on this order → record the governing "label printed" event.
    const prior = await pool.query(
      `SELECT 1 FROM documents
        WHERE entity_type = 'SHIPPING_LABEL' AND entity_id = $1 LIMIT 1`,
      [orderId],
    );
    const isFirstLabel = (prior.rowCount ?? 0) === 0;

    const inserted = await pool.query<DbRow>(
      `INSERT INTO documents (entity_type, entity_id, document_type, document_data, organization_id)
       VALUES ('SHIPPING_LABEL', $1, 'shipping_label', $2::jsonb, $3::uuid)
       RETURNING id, entity_id, document_data, created_at`,
      [orderId, JSON.stringify({ url: labelUrl, carrier, tracking, uploadedBy }), ctx.organizationId],
    );

    if (isFirstLabel) {
      await createAuditLog(pool, {
        actorStaffId: uploadedBy,
        source: 'api.order-labels',
        action: 'orders.label.printed',
        entityType: 'ORDER',
        entityId: String(orderId),
        afterData: { labelUrl, carrier, tracking },
        metadata: { orderId },
      });
      // First-time stamp (fast read projection; audit_logs is the SoT).
      // `orders` is tenant-owned → run on the GUC path with an explicit org filter.
      await withTenantTransaction(ctx.organizationId as OrgId, (client) =>
        client.query(
          `UPDATE orders SET label_printed_at = NOW(), label_printed_by = $1
             WHERE id = $2 AND label_printed_at IS NULL AND organization_id = $3`,
          [uploadedBy ?? null, orderId, ctx.organizationId],
        ),
      );
    }

    return NextResponse.json({ success: true, label: mapRow(inserted.rows[0]) });
  } catch (error) {
    return errorResponse(error, 'POST /api/order-labels');
  }
}, { permission: 'orders.create' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) throw ApiError.badRequest('Valid id is required');

    const existing = await pool.query<{ entity_id: number }>(
      `SELECT entity_id FROM documents WHERE id = $1 AND entity_type = 'SHIPPING_LABEL'`,
      [id],
    );
    if (existing.rowCount === 0) throw ApiError.notFound('label', id);

    // `documents` has no organization_id; gate tenant access on the owning order
    // (entity_id). 404 (not 403) on a cross-org label so existence stays opaque.
    const orderId = Number(existing.rows[0].entity_id);
    const owner = await tenantQuery(
      ctx.organizationId as OrgId,
      `SELECT 1 FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [orderId, ctx.organizationId],
    );
    if (owner.rowCount === 0) throw ApiError.notFound('label', id);

    // Unlink the DB row; the NAS file is removed browser-direct (deleteNasPhoto),
    // mirroring how receiving photo deletes work.
    await pool.query(`DELETE FROM documents WHERE id = $1`, [id]);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/order-labels');
  }
}, { permission: 'orders.create' });
